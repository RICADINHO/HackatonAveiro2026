#!/usr/bin/env python3
"""Open a random image with its Mapillary detections drawn on top.

Usage:
    python3 Datasets/mapillary/check.py

Requires pillow (`uv pip install pillow`). Requires a prior --images run so
the JPEGs exist under data/images/.
"""
import json
import os
import random
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

DATA = Path(__file__).parent / "data"
COLORS = {"sign": "red", "lighting": "yellow", "waste": "cyan"}


def open_file(path):
    if sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def main():
    dets = [json.loads(l) for l in open(DATA / "detections.jsonl")]
    
    by_image = defaultdict(list)
    for d in dets:
        by_image[d["image_id"]].append(d)

    # Only images we actually downloaded, with at least one detection.
    candidates = [i for i in by_image if (DATA / "images" / f"{i}.jpg").exists()]
    if not candidates:
        raise SystemExit("no image with detections in data/images/ — run with --images first")

    image_id = random.choice(candidates)
    img_path = DATA / "images" / f"{image_id}.jpg"

    im = Image.open(img_path).convert("RGB")
    w, h = im.size
    draw = ImageDraw.Draw(im)
    
    for d in by_image[image_id]:
        x0, y0, x1, y1 = d["bbox"]
        draw.rectangle([x0 * w, y0 * h, x1 * w, y1 * h],
                       outline=COLORS.get(d["category"], "white"), width=4)
        draw.text((x0 * w + 4, y0 * h + 4), d["object_value"][:24], fill="white")

    print(f"{image_id}  {w}x{h}  {len(by_image[image_id])} detections")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        im.save(tmp.name)
    open_file(tmp.name)


if __name__ == "__main__":
    main()