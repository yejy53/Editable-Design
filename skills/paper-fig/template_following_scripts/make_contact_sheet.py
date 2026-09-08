#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+", help="Preview images to include.")
    parser.add_argument("--output", required=True, help="Output PNG path.")
    parser.add_argument("--cols", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    image_paths = [Path(value).expanduser().resolve() for value in args.images]
    for image_path in image_paths:
        if not image_path.exists():
            raise FileNotFoundError(image_path)

    thumbs = [Image.open(path).convert("RGB") for path in image_paths]
    tile_w = max(image.width for image in thumbs)
    tile_h = max(image.height for image in thumbs)
    label_h = 48
    pad = 18
    cols = max(1, args.cols)
    rows = math.ceil(len(thumbs) / cols)

    sheet = Image.new(
        "RGB",
        (cols * tile_w + (cols + 1) * pad, rows * (tile_h + label_h) + (rows + 1) * pad),
        "white",
    )
    draw = ImageDraw.Draw(sheet)

    for idx, image in enumerate(thumbs):
        row, col = divmod(idx, cols)
        x = pad + col * (tile_w + pad)
        y = pad + row * (tile_h + label_h + pad)
        sheet.paste(image, (x, y))
        draw.text((x + 8, y + tile_h + 14), f"Slide {idx + 1:02d}", fill=(20, 30, 50))
        image.close()

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
