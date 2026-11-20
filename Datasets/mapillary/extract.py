#!/usr/bin/env python3
"""Download Mapillary map features (and their source images) relevant to the
Aveiro urban-furniture challenge: traffic signs, street lighting, waste bins.

Outputs, under Datasets/mapillary/data/:
  map_features.geojson  one Point per deduplicated real-world object
  images.jsonl          metadata of every image that contributed to a feature
  detections.jsonl      per-(feature, image) bbox/polygon in image space
  images/<id>.jpg       1024px thumbnails (only with --images)
  raw_<bbox>.json       raw map-feature response cache (keyed by bbox)

With --exif, GPS coordinates and compass direction from the API are written
into the EXIF of each downloaded JPEG. Re-running patches existing files
without re-downloading. EXIF injection uses piexif first (verified), and
falls back to exiftool if piexif silently no-ops on Facebook CDN JPEGs.
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from fnmatch import fnmatch
from pathlib import Path

import mapbox_vector_tile
import piexif
import requests
from dotenv import load_dotenv

API = "https://graph.mapillary.com"
ROOT = Path(__file__).parents[2]
OUT = Path(__file__).parent / "data"

CELL = 0.009  # degrees; API requires bbox smaller than 0.01 degrees square
LIMIT = 2000  # API max per request; bbox search has no paging, so split on hit

# Test cap on the image download + EXIF phase. Metadata (images.jsonl,
# detections.jsonl, map_features.geojson) is still written for ALL features.
# Set to None to unblock the full download.
MAX_IMAGES = None

REGIONS = {
    "pilot": (-8.6524, 40.6407, -8.6476, 40.6443),
    "centre": (-8.670, 40.625, -8.630, 40.660),
    "aveiro": (-8.76, 40.55, -8.50, 40.72),
    "district": (-8.98, 40.35, -7.95, 41.05),
}

VALUES = {
    "sign": ["regulatory--*", "warning--*", "information--*"],
    "lighting": ["object--street-light"],
    "waste": ["object--trash-can"],
}

FEATURE_FIELDS = (
    "id,object_value,object_type,geometry,aligned_direction,"
    "first_seen_at,last_seen_at,images"
)
IMAGE_FIELDS = (
    "id,captured_at,geometry,computed_geometry,compass_angle,"
    "computed_compass_angle,is_pano,width,height,sequence,thumb_1024_url"
)


class TooMuchData(Exception):
    """API refused the request because the response would be too large."""


def category(value):
    for cat, patterns in VALUES.items():
        if any(fnmatch(value, p) for p in patterns):
            return cat
    return None


def get(session, path, **params):
    """GET with retry on transient errors (5xx, 429, is_transient)."""
    for attempt in range(6):
        r = session.get(f"{API}/{path}", params=params, timeout=60)
        if r.status_code == 200:
            return r.json()
        if "reduce the amount of data" in r.text:
            raise TooMuchData
        try:
            transient = r.json().get("error", {}).get("is_transient", False)
        except ValueError:
            transient = False
        if r.status_code < 500 and r.status_code != 429 and not transient:
            break
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{r.status_code} {r.url.split('access_token')[0]}: {r.text[:300]}")


def safe(fn, tries=4):
    """Retry fn(*args, **kwargs) with exponential backoff.

    Accepts arbitrary args/kwargs so it can wrap any callable signature.
    Returns None and logs 'skip:' only after all tries are exhausted.
    """
    def w(*args, **kwargs):
        for t in range(tries):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                if t == tries - 1:
                    print(f"\nskip: {repr(args)[:80]} {e!r}", file=sys.stderr)
                    return None
                time.sleep(2 ** t)
    return w


def cells(west, south, east, north):
    x = west
    while x < east:
        y = south
        while y < north:
            yield (x, y, min(x + CELL, east), min(y + CELL, north))
            y += CELL
        x += CELL


def fetch(session, bbox, values, fields):
    """All map features in bbox; quarter the bbox if the cap or size limit is hit."""
    params = {"bbox": ",".join(f"{v:.6f}" for v in bbox), "fields": fields, "limit": LIMIT}
    if values:
        params["object_values"] = ",".join(values)
    w, s, e, n = bbox
    tiny = e - w < 0.0005  # ~50 m, stop splitting
    try:
        data = get(session, "map_features", **params)["data"]
        if len(data) < LIMIT or tiny:
            return data
    except TooMuchData:
        if tiny:
            raise
    mx, my = (w + e) / 2, (s + n) / 2
    quarters = ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n))
    return [f for q in quarters for f in fetch(session, q, values, fields)]


def fetch_images(session, ids):
    """Image metadata via the multiple-entities endpoint, 50 ids per request."""
    batches = [ids[i:i + 50] for i in range(0, len(ids), 50)]

    def one(batch):
        resp = get(session, "", ids=",".join(batch), fields=IMAGE_FIELDS)
        return resp["data"] if "data" in resp else list(resp.values())

    with ThreadPoolExecutor(8) as ex:
        return [img for chunk in ex.map(safe(one), batches) if chunk for img in chunk]


def decode_polygon(b64):
    """Detection geometry -> polygon in image coords normalized to 0..1 (origin top-left)."""
    data = base64.b64decode(b64)
    try:
        tile = mapbox_vector_tile.decode(
            data, default_options={"y_coord_down": True}
        )
    except TypeError:
        # Older mapbox_vector_tile versions use keyword args directly.
        tile = mapbox_vector_tile.decode(data, y_coord_down=True)
    layer = next(iter(tile.values()))
    ring = layer["features"][0]["geometry"]["coordinates"][0]
    return [[x / layer["extent"], y / layer["extent"]] for x, y in ring]


def fetch_detections(session, features, workers):
    """One request per map feature: where it appears in each source image."""
    def one(f):
        p = f["properties"]
        data = get(session, f"{p['id']}/detections",
                   fields="id,value,geometry,image").get("data", [])
        rows = []
        for d in data:
            ring = decode_polygon(d["geometry"])
            xs, ys = zip(*ring)
            rows.append({
                "detection_id": d["id"],
                "feature_id": p["id"],
                "image_id": d["image"]["id"],
                "category": p["category"],
                "object_value": d["value"],
                "bbox": [min(xs), min(ys), max(xs), max(ys)],
                "polygon": ring,
            })
        return rows

    with ThreadPoolExecutor(workers) as ex:
        rows_list = ex.map(safe(one), features)
        return [r for rows in rows_list if rows for r in rows]


# ---------------------------------------------------------------------------
# Image download + EXIF injection
# ---------------------------------------------------------------------------

def _to_deg_rational(value):
    """Decimal degrees -> ((d,1),(m,1),(s,10000)) for piexif GPS IFD."""
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600 * 10000)
    return ((d, 1), (m, 1), (s, 10000))


def _build_gps_ifd(img_meta):
    """Build a piexif GPS IFD from Mapillary API metadata, or None if unusable."""
    geom = img_meta.get("computed_geometry") or img_meta.get("geometry")
    if not geom or geom.get("type") != "Point":
        return None
    lon, lat = geom["coordinates"]  # GeoJSON order: [lon, lat]

    gps_ifd = {
        piexif.GPSIFD.GPSVersionID: (2, 3, 0, 0),
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: _to_deg_rational(abs(lat)),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: _to_deg_rational(abs(lon)),
    }

    direction = (
        img_meta.get("computed_compass_angle")
        if img_meta.get("computed_compass_angle") is not None
        else img_meta.get("compass_angle")
    )
    if direction is not None:
        gps_ifd[piexif.GPSIFD.GPSImgDirectionRef] = b"T"
        gps_ifd[piexif.GPSIFD.GPSImgDirection] = (int(round(direction * 100)), 100)

    return gps_ifd


def _inject_piexif(path, gps_ifd):
    """Try to inject GPS via piexif using an explicit BytesIO output buffer.

    Returns the new JPEG bytes on verified success, or None if piexif
    refused to modify the file or verification failed.
    """
    data = path.read_bytes()
    try:
        exif_dict = piexif.load(data)          # read existing EXIF if present
    except Exception:
        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}
    exif_dict["GPS"] = gps_ifd
    exif_bytes = piexif.dump(exif_dict)

    try:
        out = io.BytesIO()
        piexif.insert(exif_bytes, data, out)   # explicit output buffer
        new_data = out.getvalue()
    except Exception as e:
        print(f"\npiexif.insert failed for {path.name}: {e!r}", file=sys.stderr)
        return None

    if not new_data or new_data == data:
        print(f"\npiexif no-op for {path.name}", file=sys.stderr)
        return None

    # Verify: GPS must be readable back from the new bytes.
    try:
        check = piexif.load(new_data)
        if piexif.GPSIFD.GPSLatitude not in check.get("GPS", {}):
            print(f"\npiexif verify failed for {path.name}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"\npiexif verify error for {path.name}: {e!r}", file=sys.stderr)
        return None

    return new_data


def _inject_exiftool(path, gps_ifd):
    """Fallback: write GPS via exiftool. Returns True on success."""
    def deg(v):
        return v[0][0] + v[1][0] / 60 + v[2][0] / v[2][1] / 3600

    lat_ref = gps_ifd[piexif.GPSIFD.GPSLatitudeRef]
    lon_ref = gps_ifd[piexif.GPSIFD.GPSLongitudeRef]
    if isinstance(lat_ref, bytes):
        lat_ref = lat_ref.decode()
    if isinstance(lon_ref, bytes):
        lon_ref = lon_ref.decode()
    lat = deg(gps_ifd[piexif.GPSIFD.GPSLatitude])
    lon = deg(gps_ifd[piexif.GPSIFD.GPSLongitude])

    args = [
        "exiftool", "-overwrite_original", "-q",
        f"-GPSLatitude={lat:.9f}", f"-GPSLatitudeRef={lat_ref}",
        f"-GPSLongitude={lon:.9f}", f"-GPSLongitudeRef={lon_ref}",
    ]
    if piexif.GPSIFD.GPSImgDirection in gps_ifd:
        num, den = gps_ifd[piexif.GPSIFD.GPSImgDirection]
        args.append(f"-GPSImgDirection={num / den:.4f}")
        args.append("-GPSImgDirectionRef=T")
    args.append(str(path))

    try:
        subprocess.run(args, check=True, capture_output=True, timeout=30)
        return True
    except FileNotFoundError:
        print(f"\nexiftool not found (fallback unavailable for {path.name})",
              file=sys.stderr)
        return False
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        err = getattr(e, "stderr", b"") or b""
        print(f"\nexiftool inject failed for {path.name}: {err[:300]!r}",
              file=sys.stderr)
        return False


def download_one(img):
    """Download a single thumbnail if missing. Atomic via .part + rename."""
    path = OUT / "images" / f"{img['id']}.jpg"
    url = img.get("thumb_1024_url")
    if path.exists() or not url:
        return
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    tmp = path.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(path)


def inject_one(img):
    """Inject GPS + compass direction into a JPEG. Atomic, verified, with fallback."""
    path = OUT / "images" / f"{img['id']}.jpg"
    if not path.exists():
        return False

    gps_ifd = _build_gps_ifd(img)
    if gps_ifd is None:
        print(f"\nEXIF skip (no geometry): {path.name}", file=sys.stderr)
        return False

    # 1) piexif with explicit BytesIO output + verification
    new_data = _inject_piexif(path, gps_ifd)
    if new_data is not None:
        tmp = path.with_suffix(".jpg.part")
        try:
            tmp.write_bytes(new_data)
            tmp.replace(path)
            return True
        except Exception as e:
            print(f"\nEXIF write failed for {path.name}: {e!r}", file=sys.stderr)
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    # 2) fallback: exiftool
    return _inject_exiftool(path, gps_ifd)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", choices=REGIONS, default="pilot")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("W", "S", "E", "N"))
    ap.add_argument("--probe", action="store_true",
                    help="count ALL map feature classes in region, write nothing")
    ap.add_argument("--images", action="store_true", help="also download 1024px JPEGs")
    ap.add_argument("--exif", action="store_true",
                    help="inject GPS + compass direction into JPEGs "
                         "(implies --images; re-runs patch existing files)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    if args.exif:
        args.images = True

    load_dotenv(ROOT / ".env")
    token = os.environ.get("MAPILLARY_ACCESS_TOKEN")
    if not token:
        sys.exit("MAPILLARY_ACCESS_TOKEN not set (add it to .env at project root)")
    session = requests.Session()
    session.headers["Authorization"] = f"OAuth {token}"

    bbox = args.bbox or REGIONS[args.region]
    values = None if args.probe else [p for ps in VALUES.values() for p in ps]
    fields = "id,object_value" if args.probe else FEATURE_FIELDS
    grid = list(cells(*bbox))

    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / ("raw_" + "_".join(f"{v:.4f}" for v in bbox) + ".json")
    if cache.exists() and not args.probe:
        feats = json.loads(cache.read_text())
        print(f"loaded {len(feats)} from cache", file=sys.stderr)
    else:
        fetch_cell = safe(lambda b: fetch(session, b, values, fields))
        feats, todo = {}, grid
        for attempt in range(2):
            failed = []
            with ThreadPoolExecutor(args.workers) as ex:
                for i, (b, chunk) in enumerate(zip(todo, ex.map(fetch_cell, todo)), 1):
                    if chunk is None:
                        failed.append(b)
                        continue
                    feats.update({f["id"]: f for f in chunk})
                    print(f"\rpass {attempt} cells {i}/{len(todo)}  features {len(feats)}",
                          end="", file=sys.stderr)
            todo = failed
            if not todo:
                break
        print(file=sys.stderr)
        if todo:
            print(f"WARNING: {len(todo)} cells failed twice, cache has holes: {todo}",
                  file=sys.stderr)
        if not args.probe:
            cache.write_text(json.dumps(feats))

    if not args.probe:
        n = len(feats)
        feats = {k: f for k, f in feats.items() if f.get("geometry")}
        print(f"dropped {n - len(feats)} without geometry", file=sys.stderr)

    if args.probe:
        counts = Counter(f["object_value"] for f in feats.values())
        for value, n in counts.most_common():
            print(f"{n:6d} {'*' if category(value) else ' '} {value}")
        print("\n* = relevant to challenge")
        return

    geojson = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "geometry": f["geometry"],
        "properties": {
            "id": f["id"],
            "category": category(f["object_value"]),
            "object_value": f["object_value"],
            "object_type": f.get("object_type"),
            "aligned_direction": f.get("aligned_direction"),
            "first_seen_at": f.get("first_seen_at"),
            "last_seen_at": f.get("last_seen_at"),
            "image_ids": [i["id"] for i in (f.get("images") or {}).get("data", [])],
        },
    } for f in feats.values()]}
    (OUT / "map_features.geojson").write_text(json.dumps(geojson))
    print(f"{len(feats)} features", dict(Counter(
        f["properties"]["category"] for f in geojson["features"])))

    dets = fetch_detections(session, geojson["features"], args.workers)
    with open(OUT / "detections.jsonl", "w") as fh:
        for d in dets:
            fh.write(json.dumps(d) + "\n")
    print(f"{len(dets)} detections")

    image_ids = sorted({i for f in geojson["features"] for i in f["properties"]["image_ids"]})
    images = fetch_images(session, image_ids)
    with open(OUT / "images.jsonl", "w") as fh:
        for img in images:
            fh.write(json.dumps(img) + "\n")
    print(f"{len(images)} images (metadata)")

    if not args.images:
        return

    # Cap the image phase for testing; metadata files above are unaffected.
    if MAX_IMAGES:
        images = images[:MAX_IMAGES]
        print(f"capped image phase at MAX_IMAGES={MAX_IMAGES}", file=sys.stderr)

    (OUT / "images").mkdir(exist_ok=True)
    todo = [i for i in images if i.get("thumb_1024_url")]

    # --- 1. Download (network) — retried, isolated from EXIF ---
    downloader = safe(download_one)
    for attempt in range(3):
        with ThreadPoolExecutor(args.workers) as ex:
            list(ex.map(downloader, todo))
        todo = [i for i in todo
                if not (OUT / "images" / f"{i['id']}.jpg").exists()]
        if not todo:
            break
        time.sleep(30)
    if todo:
        print(f"images missing after retries: {len(todo)}", file=sys.stderr)

    # --- 2. EXIF injection (local) — no retries, best-effort, atomic ---
    if args.exif:
        targets = [i for i in images
                   if (OUT / "images" / f"{i['id']}.jpg").exists()]
        ok = fail = 0
        with ThreadPoolExecutor(args.workers) as ex:
            for result in ex.map(inject_one, targets):
                if result:
                    ok += 1
                else:
                    fail += 1
        print(f"EXIF written to {ok} images ({fail} skipped/failed)")


if __name__ == "__main__":
    main()