# https://www.mapillary.com/app/

Here we will try to get the relevant information from mapillary.

## Usage

**1. API key.** Put your Mapillary token in `.env` at the repo root:

```
MAPILLARY_ACCESS_TOKEN=MLY|...
```

**2. Run.**

```bash
python3 Datasets/mapillary/extract.py                   # features + image metadata + detections
python3 Datasets/mapillary/extract.py --images          # also download 1024px JPEGs
python3 Datasets/mapillary/extract.py --probe           # dry run: just count object classes
python3 Datasets/mapillary/check.py                     # pop up a random image with detections drawn
```

Pick the area with `--region`:

| region     | size               |
|------------|--------------------|
| `pilot`    | ~400 m, centre     |
| `centre`   | ~3.4 × 3.9 km      |
| `aveiro`   | municipality       |
| `district` | Aveiro district    |

Or an arbitrary box: `--bbox W S E N` (lon lat lon lat).

**3. Output** in `Datasets/mapillary/data/`:

- `map_features.geojson` — one point per real-world object (lon/lat)
- `images.jsonl` — metadata for every image that saw a feature
- `detections.jsonl` — per (feature, image) bbox + polygon **in image space** (normalized 0–1), i.e. where the object sits inside the picture
- `images/<id>.jpg` — only with `--images`