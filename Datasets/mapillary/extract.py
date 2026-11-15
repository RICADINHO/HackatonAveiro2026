#!/usr/bin/env python3
"""Download Mapillary map features (and their source images) relevant to the
Aveiro urban-furniture challenge: traffic signs, street lighting, waste bins.

Outputs, under Datasets/mapillary/data/:
  map_features.geojson  one Point per deduplicated real-world object
  images.jsonl          metadata of every image that contributed to a feature
  detections.jsonl      per-(feature, image) bbox/polygon in image space
  images/<id>.jpg       1024px thumbnails (only with --images)
"""
import argparse
import base64
import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from fnmatch import fnmatch
from pathlib import Path

import mapbox_vector_tile
import requests
from dotenv import load_dotenv

API = "https://graph.mapillary.com"
ROOT = Path(__file__).parents[2]
OUT = Path(__file__).parent / "data"

CELL = 0.009  # degrees; API requires bbox smaller than 0.01 degrees square
LIMIT = 2000  # API max per request; bbox search has no paging, so split on hit

# west, south, east, north (approximate, adjust as needed)
REGIONS = {
    "pilot": (-8.6524, 40.6407, -8.6476, 40.6443),  # ~400 m, city centre
    "centre": (-8.670, 40.625, -8.630, 40.660),     # Aveiro city centre
    "aveiro": (-8.76, 40.55, -8.50, 40.72),        # Aveiro municipality
    "district": (-8.98, 40.35, -7.95, 41.05),      # Aveiro district
}

# Mapillary object_value patterns per challenge category (wildcards supported)
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
    """GET with retry on transient errors (5xx, rate limit)."""
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
        if r.status_code < 500 and not transient:
            break
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{r.status_code} {r.url.split('access_token')[0]}: {r.text[:300]}")


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
        return [img for chunk in ex.map(one, batches) for img in chunk]


def decode_polygon(b64):
    """Detection geometry -> polygon in image coords normalized to 0..1 (origin top-left)."""
    tile = mapbox_vector_tile.decode(base64.b64decode(b64), y_coord_down=True)
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
        return [r for rows in ex.map(one, features) for r in rows]


def download(img):
    path = OUT / "images" / f"{img['id']}.jpg"
    url = img.get("thumb_1024_url")
    if path.exists() or not url:
        return
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    path.write_bytes(r.content)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", choices=REGIONS, default="pilot")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("W", "S", "E", "N"))
    ap.add_argument("--probe", action="store_true",
                    help="count ALL map feature classes in region, write nothing")
    ap.add_argument("--images", action="store_true", help="also download 1024px JPEGs")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    session = requests.Session()
    session.headers["Authorization"] = f"OAuth {os.environ['MAPILLARY_ACCESS_TOKEN']}"

    bbox = args.bbox or REGIONS[args.region]
    values = None if args.probe else [p for ps in VALUES.values() for p in ps]
    fields = "id,object_value" if args.probe else FEATURE_FIELDS
    grid = list(cells(*bbox))

    feats = {}
    with ThreadPoolExecutor(args.workers) as ex:
        for i, chunk in enumerate(ex.map(lambda b: fetch(session, b, values, fields), grid), 1):
            feats.update({f["id"]: f for f in chunk})
            print(f"\rcells {i}/{len(grid)}  features {len(feats)}", end="", file=sys.stderr)
    print(file=sys.stderr)

    if args.probe:
        counts = Counter(f["object_value"] for f in feats.values())
        for value, n in counts.most_common():
            print(f"{n:6d} {'*' if category(value) else ' '} {value}")
        print("\n* = relevant to challenge")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    geojson = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "geometry": f["geometry"],
        "properties": {
            "id": f["id"],
            "category": category(f["object_value"]),
            "object_value": f["object_value"],
            "object_type": f["object_type"],
            "aligned_direction": f.get("aligned_direction"),
            "first_seen_at": f.get("first_seen_at"),
            "last_seen_at": f.get("last_seen_at"),
            "image_ids": [i["id"] for i in f.get("images", {}).get("data", [])],
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

    if args.images:
        (OUT / "images").mkdir(exist_ok=True)
        with ThreadPoolExecutor(args.workers) as ex:
            list(ex.map(download, images))
        print("images downloaded")


if __name__ == "__main__":
    main()