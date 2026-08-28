#!/usr/bin/env python3
"""Turn a flat chroma-key image into a PNG or WebP with alpha."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
from statistics import median
import sys


def fail(message: str) -> None:
    print(f"remove-chroma-key: {message}", file=sys.stderr)
    raise SystemExit(2)


def load_pillow():
    try:
        from PIL import Image, ImageFilter
    except ImportError:
        fail("Pillow is required; install it with `python3 -m pip install pillow`.")
    return Image, ImageFilter


def parse_color(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value.strip())
    if not match:
        fail("--key-color must be a six-digit RGB hex value such as #00ff00")
    raw = match.group(1)
    return tuple(int(raw[index : index + 2], 16) for index in (0, 2, 4))


def sample_key(image, mode: str) -> tuple[int, int, int]:
    width, height = image.size
    pixels = image.load()
    samples: list[tuple[int, int, int]] = []
    band = max(1, min(width, height, 6))

    if mode == "corners":
        patch = max(1, min(width, height, 12))
        boxes = (
            (0, 0, patch, patch),
            (width - patch, 0, width, patch),
            (0, height - patch, patch, height),
            (width - patch, height - patch, width, height),
        )
        for left, top, right, bottom in boxes:
            for y in range(top, bottom):
                for x in range(left, right):
                    samples.append(tuple(pixels[x, y][:3]))
    else:
        step = max(1, min(width, height) // 256)
        for x in range(0, width, step):
            for offset in range(band):
                samples.append(tuple(pixels[x, offset][:3]))
                samples.append(tuple(pixels[x, height - 1 - offset][:3]))
        for y in range(0, height, step):
            for offset in range(band):
                samples.append(tuple(pixels[offset, y][:3]))
                samples.append(tuple(pixels[width - 1 - offset, y][:3]))

    if not samples:
        fail("could not sample a key color from the image border")
    return tuple(int(round(median(pixel[channel] for pixel in samples))) for channel in range(3))


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def matte_alpha(distance: int, transparent: float, opaque: float) -> int:
    if distance <= transparent:
        return 0
    if distance >= opaque:
        return 255
    return round(255 * smoothstep((distance - transparent) / (opaque - transparent)))


def spill_channels(key: tuple[int, int, int]) -> list[int]:
    maximum = max(key)
    if maximum < 128:
        return []
    return [index for index, value in enumerate(key) if value >= maximum - 16 and value >= 128]


def dominance(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> float:
    spills = spill_channels(key)
    if not spills:
        return 0.0
    others = [index for index in range(3) if index not in spills]
    key_strength = min(rgb[index] for index in spills)
    other_strength = max((rgb[index] for index in others), default=0)
    return float(key_strength - other_strength)


def dominance_alpha(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> int:
    amount = dominance(rgb, key)
    if amount <= 0:
        return 255
    spills = spill_channels(key)
    others = [index for index in range(3) if index not in spills]
    other_strength = max((rgb[index] for index in others), default=0)
    denominator = max(1.0, max(key) - other_strength)
    return round(255 * (1.0 - min(1.0, amount / denominator)))


def despill(rgb: tuple[int, int, int], key: tuple[int, int, int], alpha: int) -> tuple[int, int, int]:
    if alpha >= 252:
        return rgb
    spills = spill_channels(key)
    others = [index for index in range(3) if index not in spills]
    if not spills or not others:
        return rgb
    values = list(rgb)
    cap = max(0, max(values[index] for index in others) - 1)
    for index in spills:
        values[index] = min(values[index], cap)
    return tuple(values)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--key-color", default="#00ff00")
    parser.add_argument("--auto-key", choices=("none", "corners", "border"), default="border")
    parser.add_argument("--soft-matte", action="store_true")
    parser.add_argument("--transparent-threshold", type=float, default=12.0)
    parser.add_argument("--opaque-threshold", type=float, default=220.0)
    parser.add_argument("--despill", action="store_true")
    parser.add_argument("--edge-contract", type=int, default=0)
    parser.add_argument("--edge-feather", type=float, default=0.0)
    parser.add_argument("--force", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    source = Path(args.input)
    output = Path(args.out)
    if not source.is_file():
        fail(f"input image not found: {source}")
    if output.exists() and not args.force:
        fail(f"output already exists: {output}; pass --force to replace it")
    if output.suffix.lower() not in {".png", ".webp"}:
        fail("--out must end in .png or .webp")
    if not 0 <= args.transparent_threshold < args.opaque_threshold <= 255:
        fail("matte thresholds must satisfy 0 <= transparent < opaque <= 255")
    if not 0 <= args.edge_contract <= 16 or not 0 <= args.edge_feather <= 64:
        fail("edge contract must be 0..16 and edge feather must be 0..64")

    Image, ImageFilter = load_pillow()
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
    key = sample_key(image, args.auto_key) if args.auto_key != "none" else parse_color(args.key_color)
    pixels = image.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            red, green, blue, original_alpha = pixels[x, y]
            rgb = (red, green, blue)
            distance = max(abs(rgb[index] - key[index]) for index in range(3))
            key_like = distance <= 32 or dominance(rgb, key) >= 16
            alpha = 255
            if key_like:
                alpha = min(
                    matte_alpha(distance, args.transparent_threshold, args.opaque_threshold),
                    dominance_alpha(rgb, key),
                )
            alpha = round(alpha * original_alpha / 255)
            if alpha <= 8:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if args.despill and key_like:
                red, green, blue = despill(rgb, key, alpha)
            pixels[x, y] = (red, green, blue, alpha)

    alpha_channel = image.getchannel("A")
    for _ in range(args.edge_contract):
        alpha_channel = alpha_channel.filter(ImageFilter.MinFilter(3))
    if args.edge_feather:
        alpha_channel = alpha_channel.filter(ImageFilter.GaussianBlur(args.edge_feather))
    image.putalpha(alpha_channel)

    histogram = alpha_channel.histogram()
    total = width * height
    transparent = sum(histogram[:13])
    partial = sum(histogram[13:255])
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    print(f"wrote {output}")
    print(f"key color: #{key[0]:02x}{key[1]:02x}{key[2]:02x}")
    print(f"transparent pixels: {transparent}/{total}")
    print(f"partially transparent pixels: {partial}/{total}")


if __name__ == "__main__":
    main()
