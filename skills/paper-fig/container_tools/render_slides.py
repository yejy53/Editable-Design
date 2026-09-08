#!/usr/bin/env python3
# Copyright (c) OpenAI. All rights reserved.
import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from os import makedirs, replace
from os.path import abspath, basename, dirname, exists, expanduser, join, splitext
from typing import Sequence, cast
from zipfile import ZipFile

from pdf2image import convert_from_path, pdfinfo_from_path
from PIL import Image

SCRIPT_DIR = dirname(__file__)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from runtime_helpers import runtime_bin_dir, runtime_node  # noqa: E402

EMU_PER_INCH: int = 914_400
PRESENTATION_EXTS = (".pptx", ".ppsx", ".potx", ".pptm", ".ppsm", ".potm")


def calc_dpi_via_ooxml(input_path: str, max_w_px: int, max_h_px: int) -> int:
    """Calculate DPI from OOXML `ppt/presentation.xml` slide size (cx/cy in EMUs)."""
    with ZipFile(input_path, "r") as zf:
        xml = zf.read("ppt/presentation.xml")
    root = ET.fromstring(xml)
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
    sld_sz = root.find("p:sldSz", ns)
    if sld_sz is None:
        raise RuntimeError("Slide size not found in presentation.xml")
    cx = int(sld_sz.get("cx") or 0)
    cy = int(sld_sz.get("cy") or 0)
    if cx <= 0 or cy <= 0:
        raise RuntimeError("Invalid slide size values in presentation.xml")
    width_in = cx / EMU_PER_INCH
    height_in = cy / EMU_PER_INCH
    return round(min(max_w_px / width_in, max_h_px / height_in))


def calc_dpi_via_pdf(input_path: str, max_w_px: int, max_h_px: int) -> int:
    """Compute DPI from PDF page size.

    For OOXML presentation inputs, use the presentation slide size directly.
    For PDFs, use the PDF directly.
    """
    is_pdf = input_path.lower().endswith(".pdf")
    if not is_pdf:
        if input_path.lower().endswith(PRESENTATION_EXTS):
            return calc_dpi_via_ooxml(input_path, max_w_px, max_h_px)
        raise RuntimeError("DPI computation is supported for PDF and OOXML presentation inputs.")

    info = pdfinfo_from_path(
        input_path,
        poppler_path=runtime_bin_dir("pdfinfo", "pdftoppm"),
    )
    size_val = info.get("Page size")
    if not size_val:
        for k, v in info.items():
            if isinstance(v, str) and "size" in k.lower() and "pts" in v:
                size_val = v
                break
    if not isinstance(size_val, str):
        raise RuntimeError("Failed to read PDF page size for DPI computation.")

    def _parse_page_size_to_pts(s: str) -> tuple[float, float]:
        # Common formats from poppler/pdfinfo:
        # - "612 x 792 pts (letter)"
        # - "595.276 x 841.89 pts (A4)"
        # - sometimes inches: "8.5 x 11 in"
        m_pts = re.search(
            r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*pts\b",
            s,
        )
        if m_pts:
            return float(m_pts.group(1)), float(m_pts.group(2))
        m_in = re.search(
            r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*in\b",
            s,
        )
        if m_in:
            w_in = float(m_in.group(1))
            h_in = float(m_in.group(2))
            return w_in * 72.0, h_in * 72.0
        # Sometimes poppler returns without an explicit unit; treat as points.
        m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\b", s)
        if m:
            return float(m.group(1)), float(m.group(2))
        raise RuntimeError(f"Unrecognized PDF page size format: {s!r}")

    width_pts, height_pts = _parse_page_size_to_pts(size_val)
    width_in = width_pts / 72.0
    height_in = height_pts / 72.0
    if width_in <= 0 or height_in <= 0:
        raise RuntimeError("Invalid PDF page size values.")
    return round(min(max_w_px / width_in, max_h_px / height_in))


def _render_presentation_with_artifact_tool(
    input_path: str, out_dir: str, dpi: int
) -> Sequence[str]:
    scale = max(dpi / 96.0, 0.01)
    proc = subprocess.run(
        [
            runtime_node(),
            join(SCRIPT_DIR, "render_presentation.mjs"),
            "--input",
            input_path,
            "--output_dir",
            out_dir,
            "--scale",
            f"{scale:.6f}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        details = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            "Failed to render presentation with artifact-tool."
            + (f"\n{details}" if details else "")
        )
    payload = json.loads(proc.stdout)
    return cast(Sequence[str], payload["paths"])


def convert_to_pdf(
    pptx_path: str,
    user_profile: str,
    convert_tmp_dir: str,
    stem: str,
) -> str:
    pdf_path = join(convert_tmp_dir, f"{stem}.pdf")
    if pptx_path.lower().endswith(".pdf"):
        return pptx_path
    if not pptx_path.lower().endswith(PRESENTATION_EXTS):
        return ""

    image_dir = join(convert_tmp_dir, stem + "_pdf_pages")
    paths = list(_render_presentation_with_artifact_tool(pptx_path, image_dir, dpi=96))
    if not paths:
        return ""

    images = []
    try:
        for path in paths:
            images.append(Image.open(path).convert("RGB"))
        first, *rest = images
        first.save(pdf_path, "PDF", save_all=True, append_images=rest)
    finally:
        for image in images:
            image.close()
    return pdf_path if exists(pdf_path) else ""


def rasterize(
    input_path: str,
    out_dir: str,
    dpi: int,
) -> Sequence[str]:
    """Rasterise PPTX/PDF to PNG files placed in out_dir and return the image paths."""
    makedirs(out_dir, exist_ok=True)
    input_path = abspath(input_path)

    if input_path.lower().endswith(PRESENTATION_EXTS):
        return _render_presentation_with_artifact_tool(input_path, out_dir, dpi)

    if not input_path.lower().endswith(".pdf"):
        raise RuntimeError("Rasterization is supported for PDF and OOXML presentation inputs.")

    paths_raw = cast(
        list[str],
        convert_from_path(
            input_path,
            dpi=dpi,
            fmt="png",
            thread_count=8,
            output_folder=out_dir,
            paths_only=True,
            output_file="slide",
            poppler_path=runtime_bin_dir("pdfinfo", "pdftoppm"),
        ),
    )
    # Rename convert_from_path's output format f'slide{thread_id:04d}-{page_num:02d}.png'
    slides = []
    for src_path in paths_raw:
        base = splitext(basename(src_path))[0]
        slide_num_str = base.split("-")[-1]
        slide_num = int(slide_num_str)
        dst_path = join(out_dir, f"slide-{slide_num}.png")
        replace(src_path, dst_path)
        slides.append((slide_num, dst_path))
    slides.sort(key=lambda t: t[0])
    final_paths = [path for _, path in slides]
    return final_paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Render slides to images.")
    parser.add_argument(
        "input_path",
        type=str,
        help="Path to the input PowerPoint or PDF file.",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=None,
        help=(
            "Output directory for the rendered images. "
            "Defaults to a folder next to the input named after the input file (without extension)."
        ),
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1600,
        help=(
            "Approximate maximum width in pixels after isotropic scaling (default 1600). "
            "The actual value may exceed slightly."
        ),
    )
    parser.add_argument(
        "--height",
        type=int,
        default=900,
        help=(
            "Approximate maximum height in pixels after isotropic scaling (default 900). "
            "The actual value may exceed slightly."
        ),
    )
    args = parser.parse_args()

    input_path = abspath(expanduser(args.input_path))
    out_dir = abspath(expanduser(args.output_dir)) if args.output_dir else splitext(input_path)[0]
    if input_path.lower().endswith((".pptx", ".ppsx", ".potx", ".pptm", ".ppsm", ".potm")):
        dpi = calc_dpi_via_ooxml(input_path, args.width, args.height)
    else:
        dpi = calc_dpi_via_pdf(input_path, args.width, args.height)
    rasterize(input_path, out_dir, dpi)
    print("Slides rendered to " + out_dir)


if __name__ == "__main__":
    main()
