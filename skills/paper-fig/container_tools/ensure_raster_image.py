#!/usr/bin/env python3
"""Copyright (c) OpenAI. All rights reserved.

Ensures input images are rasterized, converting to PNG when needed. Primarily used to
preview image assets extracted from PowerPoint files.


Dependencies used by this tool:
- Codex runtime Node + sharp: SVG/SVGZ rasterization
- Codex runtime Poppler + pdf2image: PDF rasterization (first page)
- Codex runtime Pillow: TIFF/JPEG XR output bridging
- libheif-examples: heif-convert for HEIC/HEIF -> PNG
- jxr-tools (or libjxr-tools on older distros): JxrDecApp for JPEG XR (JXR/WDP)
"""

import argparse
import gzip
import sys
import tempfile
from os import listdir
from os.path import basename, dirname, expanduser, isfile, join, splitext
from subprocess import run

from pdf2image import convert_from_path
from PIL import Image

SCRIPT_DIR = dirname(__file__)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from runtime_helpers import runtime_bin_dir, runtime_binary, runtime_node  # noqa: E402

RASTER_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".webp",
}

CONVERTIBLE_EXTS = {
    # Windows metafiles (and compressed variants)
    ".emf",
    ".wmf",
    ".emz",
    ".wmz",
    # SVG
    ".svg",
    ".svgz",
    # JPEG XR / HD Photo
    ".wdp",
    ".jxr",
    # HEIF family
    ".heic",
    ".heif",
    # Page-description formats (rasterize first page)
    ".pdf",
    ".eps",
    ".ps",
}

SUPPORTED_EXTS = RASTER_EXTS | CONVERTIBLE_EXTS


def _pillow_convert(src_path: str, dst_path: str) -> None:
    with Image.open(src_path) as img:
        img.seek(0)
        if img.mode not in ("1", "L", "LA", "P", "RGB", "RGBA"):
            img = img.convert("RGBA")
        img.save(dst_path, format="PNG")


def _run_node_helper(helper_name: str, args: list[str]) -> None:
    run(
        [runtime_node(), join(SCRIPT_DIR, helper_name), *args],
        check=True,
    )


def _rasterize_svg(src_path: str, dst_path: str) -> None:
    _run_node_helper("rasterize_svg.mjs", ["--input", src_path, "--output", dst_path])


def _rasterize_svgz(src_path: str, dst_path: str) -> None:
    with tempfile.TemporaryDirectory(prefix="svgz_raster_") as tmpdir:
        decompressed = join(tmpdir, basename(splitext(src_path)[0]) + ".svg")
        with gzip.open(src_path, "rb") as zin, open(decompressed, "wb") as zout:
            zout.write(zin.read())
        _rasterize_svg(decompressed, dst_path)


def _rasterize_pdf_first_page(src_path: str, dst_path: str) -> None:
    pages = convert_from_path(
        src_path,
        dpi=200,
        first_page=1,
        last_page=1,
        fmt="png",
        poppler_path=runtime_bin_dir("pdfinfo", "pdftoppm"),
    )
    if not pages:
        raise RuntimeError("No PDF pages were rendered: " + src_path)
    pages[0].save(dst_path, format="PNG")


def _unsupported_format(path: str, reason: str) -> None:
    raise RuntimeError(f"Unsupported image format for rasterization: {path}. {reason}")


def ensure_raster_image(path: str, out_dir: str | None = None) -> str:
    """Return a raster image path for the given input, converting when needed.

    - SVG/SVGZ are rasterized via the bundled Node runtime and sharp
    - PDFs are rasterized via bundled Poppler through pdf2image
    - WDP/JXR are decoded via JxrDecApp and bridged to PNG via Pillow
    - Known raster formats are returned as-is

    Raises ValueError if the extension is not supported.
    """
    base, ext = splitext(path)
    ext_lower = ext.lower()
    out_dir = out_dir or dirname(path)
    out_path = join(out_dir, basename(base) + ".png")

    # Convertible formats
    if ext_lower in (".emf", ".wmf"):
        _unsupported_format(
            path, "No equivalent standalone EMF/WMF converter exists in the Codex runtime bundle."
        )

    if ext_lower in (".emz", ".wmz"):
        _unsupported_format(
            path, "No equivalent standalone EMF/WMF converter exists in the Codex runtime bundle."
        )

    if ext_lower == ".svg":
        _rasterize_svg(path, out_path)
        if isfile(out_path):
            return out_path
        raise RuntimeError("SVG rasterization succeeded but output file not found: " + out_path)

    if ext_lower == ".svgz":
        _rasterize_svgz(path, out_path)
        if isfile(out_path):
            return out_path
        raise RuntimeError("SVGZ rasterization succeeded but output file not found: " + out_path)

    if ext_lower in (".wdp", ".jxr"):
        tmp_tiff = join(out_dir, basename(base) + ".tiff")
        run([runtime_binary("JxrDecApp"), "-i", path, "-o", tmp_tiff], check=True)
        _pillow_convert(tmp_tiff, out_path)
        if isfile(out_path):
            return out_path
        raise RuntimeError("JPEG XR decode succeeded but PNG not found: " + out_path)

    if ext_lower in (".heic", ".heif"):
        # Use libheif's CLI for robust conversion
        heif_convert = runtime_binary("heif-convert")
        run([heif_convert, path, out_path], check=True)
        if isfile(out_path):
            return out_path
        raise RuntimeError("heif-convert reported success but output file not found: " + out_path)

    if ext_lower == ".pdf":
        _rasterize_pdf_first_page(path, out_path)
        if isfile(out_path):
            return out_path
        raise RuntimeError("PDF rasterization succeeded but output file not found: " + out_path)

    if ext_lower in (".eps", ".ps"):
        _unsupported_format(
            path, "No equivalent EPS/PS converter exists in the Codex runtime bundle."
        )

    if ext_lower in RASTER_EXTS:
        return path

    raise ValueError(f"Unsupported image format for montage: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=("Ensure input images are rasterized; convert to PNG if needed.")
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input_files", nargs="+", help="List of input image file paths")
    group.add_argument("--input_dir", help="Directory containing input images")
    parser.add_argument(
        "--output_dir",
        default=None,
        help=(
            "Directory to write converted PNGs. If omitted, converted files are written next to inputs."
        ),
    )
    args = parser.parse_args()

    if args.input_files:
        paths = [expanduser(p) for p in args.input_files]
    else:
        input_dir = expanduser(args.input_dir)
        names = listdir(input_dir)
        paths = [
            join(input_dir, f)
            for f in names
            if isfile(join(input_dir, f)) and splitext(f)[1].lower() in SUPPORTED_EXTS
        ]
        if not paths:
            raise SystemExit("No files with supported extensions in input_dir")

    out_dir = expanduser(args.output_dir) if args.output_dir else None
    converted_paths = []
    for p in paths:
        if ensure_raster_image(p, out_dir) != p:
            converted_paths.append(p)

    if converted_paths:
        print("Converted the following files to PNG:\n" + "\n".join(converted_paths))


if __name__ == "__main__":
    main()
