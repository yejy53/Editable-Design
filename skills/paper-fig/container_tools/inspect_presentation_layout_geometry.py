#!/usr/bin/env python3
"""Read-only, source-free OOXML checks for connectors and native table fit."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import posixpath
import re
import struct
import sys
import unicodedata
import zipfile
import zlib
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

# Also used by the lazy font-inspection import under Python safe-path mode.
SCRIPT_DIR = str(Path(__file__).resolve().parent)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}
EMU_PER_INCH = 914400
EMU_PER_POINT = 12700
DEFAULT_VERTICAL_MARGIN = 45720
FOOTER_REGION = 0.20
# These heuristics suggest review, not that the user's design is invalid.
# Keep structural and explicitly declared requirements in the blocking findings.
STYLE_REVIEW_KINDS = frozenset(
    {
        "connector_over_text",
        "wrapped_presentation_title_subtitle_overlap",
        "single_line_text_overflow",
        "substantial_text_frame_overlap",
        "repeated_wrapped_body_heading_overlap",
        "object_outside_slide_boundary",
        "native_table_overflow",
        "redundant_charts_duplicate_table",
        "zero_padded_slide_folio",
        "incorrect_or_missing_actual_slide_folio",
        "malformed_native_bullet_geometry",
        "primary_bullet_wall_on_editorial_slide",
        "presentation_heading_trailing_full_stop",
        "decorative_bullet_in_presentation_heading",
        "dense_bold_paragraphs_without_spacing",
        "unapproved_decorative_cover_icon",
        "unapproved_decorative_icon_cluster",
        "repeated_unapproved_decorative_icons",
    }
)
_ARIAL_ASCII_ADVANCES = (
    278,
    278,
    355,
    556,
    556,
    889,
    667,
    191,
    333,
    333,
    389,
    584,
    278,
    333,
    278,
    278,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    278,
    278,
    584,
    584,
    584,
    556,
    1015,
    667,
    667,
    722,
    722,
    667,
    611,
    778,
    722,
    278,
    500,
    667,
    556,
    833,
    722,
    778,
    667,
    778,
    722,
    667,
    611,
    722,
    667,
    944,
    667,
    667,
    611,
    278,
    278,
    278,
    469,
    556,
    333,
    556,
    556,
    500,
    556,
    556,
    278,
    556,
    556,
    222,
    222,
    500,
    222,
    833,
    556,
    556,
    556,
    556,
    333,
    500,
    278,
    556,
    500,
    722,
    500,
    500,
    500,
    334,
    260,
    334,
    584,
)
_ARIAL_BOLD_ASCII_ADVANCES = (
    278,
    333,
    474,
    556,
    556,
    889,
    722,
    238,
    333,
    333,
    389,
    584,
    278,
    333,
    278,
    278,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    333,
    333,
    584,
    584,
    584,
    611,
    975,
    722,
    722,
    722,
    722,
    667,
    611,
    778,
    722,
    278,
    556,
    722,
    611,
    833,
    722,
    778,
    667,
    778,
    722,
    667,
    611,
    722,
    667,
    944,
    667,
    667,
    611,
    333,
    278,
    333,
    584,
    556,
    333,
    556,
    611,
    556,
    611,
    556,
    333,
    611,
    611,
    278,
    278,
    556,
    278,
    889,
    611,
    611,
    611,
    611,
    389,
    556,
    333,
    611,
    556,
    778,
    556,
    556,
    500,
    389,
    280,
    389,
    584,
)
_HELVETICA_NEUE_BOLD_ASCII_ADVANCES = (
    278,
    278,
    463,
    556,
    556,
    1000,
    685,
    278,
    296,
    296,
    407,
    600,
    278,
    407,
    278,
    371,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    556,
    278,
    278,
    600,
    600,
    600,
    556,
    800,
    685,
    704,
    741,
    741,
    648,
    593,
    759,
    741,
    295,
    556,
    722,
    593,
    907,
    741,
    778,
    667,
    778,
    722,
    649,
    611,
    741,
    630,
    944,
    667,
    667,
    648,
    333,
    371,
    333,
    600,
    500,
    259,
    574,
    611,
    574,
    611,
    574,
    333,
    611,
    593,
    258,
    278,
    574,
    258,
    906,
    593,
    611,
    611,
    611,
    389,
    537,
    352,
    593,
    520,
    814,
    537,
    519,
    519,
    333,
    223,
    333,
    600,
)


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


@dataclass(frozen=True)
class SlideObject:
    object_id: str
    kind: str
    box: Box
    z: int
    element: ET.Element
    has_text: bool = False


def _local(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _box(element: ET.Element) -> Box | None:
    transform = (
        element.find("p:xfrm", NS)
        if _local(element) == "graphicFrame"
        else element.find("p:spPr/a:xfrm", NS)
    )
    if transform is None:
        return None
    offset = transform.find("a:off", NS)
    extent = transform.find("a:ext", NS)
    if offset is None or extent is None:
        return None
    return Box(
        float(offset.get("x", "0")),
        float(offset.get("y", "0")),
        float(extent.get("cx", "0")),
        float(extent.get("cy", "0")),
    )


def _object_id(element: ET.Element) -> str:
    for path in (
        "p:nvSpPr/p:cNvPr",
        "p:nvCxnSpPr/p:cNvPr",
        "p:nvGraphicFramePr/p:cNvPr",
        "p:nvPicPr/p:cNvPr",
    ):
        properties = element.find(path, NS)
        if properties is not None:
            return properties.get("id", "")
    return ""


def _slide_objects(root: ET.Element) -> list[SlideObject]:
    tree = root.find("p:cSld/p:spTree", NS)
    if tree is None:
        raise ValueError("slide has no shape tree")
    objects = []
    for z, element in enumerate(tree):
        kind = _local(element)
        if kind not in {"sp", "pic", "cxnSp", "graphicFrame"}:
            continue
        bounds = _box(element)
        if bounds is None:
            continue
        objects.append(
            SlideObject(
                object_id=_object_id(element),
                kind=kind,
                box=bounds,
                z=z,
                element=element,
                has_text=any(
                    bool((run.text or "").strip()) for run in element.findall(".//a:t", NS)
                ),
            )
        )
    return objects


def _connector_points(connector: SlideObject) -> list[tuple[float, float]]:
    transform = connector.element.find("p:spPr/a:xfrm", NS)
    geometry = connector.element.find("p:spPr/a:prstGeom", NS)
    preset = (
        geometry.get("prst", "straightConnector1") if geometry is not None else "straightConnector1"
    )
    flip_h = transform is not None and transform.get("flipH") == "1"
    flip_v = transform is not None and transform.get("flipV") == "1"
    x1, x2 = connector.box.x, connector.box.right
    y1, y2 = connector.box.y, connector.box.bottom
    if flip_h:
        x1, x2 = x2, x1
    if flip_v:
        y1, y2 = y2, y1
    if preset == "bentConnector2":
        return [(x1, y1), (x2, y1), (x2, y2)]
    if preset in {"bentConnector3", "bentConnector4", "bentConnector5"}:
        midpoint = (x1 + x2) / 2
        return [(x1, y1), (midpoint, y1), (midpoint, y2), (x2, y2)]
    return [(x1, y1), (x2, y2)]


def _is_connector_like(item: SlideObject) -> bool:
    if item.kind == "cxnSp":
        return True
    if item.kind != "sp" or item.has_text:
        return False
    line = item.element.find("p:spPr/a:ln", NS)
    if line is None:
        return False
    return line.find("a:headEnd", NS) is not None or line.find("a:tailEnd", NS) is not None


def _segment_crosses_interior(
    start: tuple[float, float], end: tuple[float, float], box: Box
) -> bool:
    """Liang-Barsky clipping; exclude endpoint-only and boundary-only contact."""
    inset = min(EMU_PER_INCH * 0.015, box.width / 4, box.height / 4)
    if inset <= 0:
        return False
    left, right = box.x + inset, box.right - inset
    top, bottom = box.y + inset, box.bottom - inset
    dx, dy = end[0] - start[0], end[1] - start[1]
    low, high = 0.0, 1.0
    for direction, distance in (
        (-dx, start[0] - left),
        (dx, right - start[0]),
        (-dy, start[1] - top),
        (dy, bottom - start[1]),
    ):
        if direction == 0:
            if distance < 0:
                return False
            continue
        ratio = distance / direction
        if direction < 0:
            low = max(low, ratio)
        else:
            high = min(high, ratio)
        if low > high:
            return False
    return high - low > 1e-8


def _endpoint_ids(connector: SlideObject) -> set[str]:
    properties = connector.element.find("p:nvCxnSpPr/p:cNvCxnSpPr", NS)
    return (
        {child.get("id", "") for child in properties if child.get("id")}
        if properties is not None
        else set()
    )


def _connector_findings(slide_number: int, objects: list[SlideObject]) -> list[dict[str, Any]]:
    findings = []
    for connector in (item for item in objects if _is_connector_like(item)):
        endpoints = _endpoint_ids(connector)
        points = _connector_points(connector)
        for text_object in objects:
            if (
                text_object.kind != "sp"
                or not text_object.has_text
                or text_object.object_id in endpoints
                or connector.z < text_object.z
            ):
                continue
            if any(
                _segment_crosses_interior(start, end, text_object.box)
                for start, end in itertools.pairwise(points)
            ):
                findings.append(
                    {
                        "kind": "connector_over_text",
                        "slide": slide_number,
                        "connector_id": connector.object_id,
                        "text_object_id": text_object.object_id,
                        "connector_z": connector.z,
                        "text_z": text_object.z,
                    }
                )
    return findings


def _occupied_text_vertical_band(item: SlideObject) -> tuple[float, float]:
    body = item.element.find("p:txBody/a:bodyPr", NS)
    properties = body.attrib if body is not None else {}
    top = float(properties.get("tIns", DEFAULT_VERTICAL_MARGIN))
    bottom = float(properties.get("bIns", DEFAULT_VERTICAL_MARGIN))
    left = float(properties.get("lIns", 91440))
    right = float(properties.get("rIns", 91440))
    usable_width = max(1.0, item.box.width - left - right)
    usable_height = max(0.0, item.box.height - top - bottom)
    occupied = min(
        usable_height,
        sum(
            _paragraph_lines(paragraph, usable_width)
            * _font_size(paragraph)
            * EMU_PER_POINT
            * _paragraph_line_spacing(paragraph)
            for paragraph in item.element.findall("p:txBody/a:p", NS)
        ),
    )
    anchor = properties.get("anchor", "t")
    if anchor == "ctr":
        start = item.box.y + top + max(0.0, usable_height - occupied) / 2
    elif anchor == "b":
        start = item.box.bottom - bottom - occupied
    else:
        start = item.box.y + top
    return start, start + occupied


def _occupied_text_horizontal_band(item: SlideObject) -> tuple[float, float]:
    """Estimate painted text, not the often deliberately oversized frame."""

    body = item.element.find("p:txBody/a:bodyPr", NS)
    properties = body.attrib if body is not None else {}
    left = float(properties.get("lIns", 91440))
    right = float(properties.get("rIns", 91440))
    usable_width = max(1.0, item.box.width - left - right)
    occupied_bands = []
    for paragraph in item.element.findall("p:txBody/a:p", NS):
        text = "".join(node.text or "" for node in paragraph.findall(".//a:t", NS))
        size = _font_size(paragraph) * EMU_PER_POINT
        occupied = min(
            usable_width,
            max(size * 0.6, max((len(line) for line in text.split("\n")), default=0) * size * 0.62),
        )
        paragraph_properties = paragraph.find("a:pPr", NS)
        alignment = (
            paragraph_properties.get("algn", "l") if paragraph_properties is not None else "l"
        )
        if alignment == "r":
            start = item.box.right - right - occupied
        elif alignment == "ctr":
            start = item.box.x + left + (usable_width - occupied) / 2
        else:
            start = item.box.x + left
        occupied_bands.append((start, start + occupied))
    if not occupied_bands:
        return item.box.x + left, item.box.right - right
    return min(band[0] for band in occupied_bands), max(band[1] for band in occupied_bands)


def _presentation_heading_pair(
    objects: list[SlideObject], slide_width: float, slide_height: float
) -> tuple[SlideObject, SlideObject | None] | None:
    """Identify an actual title/subtitle pair without treating body copy as headings."""

    candidates = []
    for item in objects:
        if (
            item.kind != "sp"
            or not item.has_text
            or item.box.width < slide_width * 0.35
            or item.box.y > slide_height * 0.58
        ):
            continue
        paragraphs = item.element.findall("p:txBody/a:p", NS)
        if len(paragraphs) == 1:
            candidates.append((item, _font_size(paragraphs[0])))
    titles = [(item, size) for item, size in candidates if size >= 20.0]
    if not titles:
        return None
    title, title_size = min(titles, key=lambda entry: entry[0].box.y)
    subtitles = []
    for item, size in candidates:
        if item.object_id == title.object_id or not 10.0 <= size < title_size * 0.83:
            continue
        if item.box.y <= title.box.y or item.box.y - title.box.bottom > slide_height * 0.13:
            continue
        overlap_width = min(title.box.right, item.box.right) - max(title.box.x, item.box.x)
        if overlap_width < min(title.box.width, item.box.width) * 0.68:
            continue
        subtitles.append(item)
    return title, min(subtitles, key=lambda item: item.box.y) if subtitles else None


def _heading_punctuation_findings(
    slide_number: int, objects: list[SlideObject], slide_width: float, slide_height: float
) -> list[dict[str, Any]]:
    headings = _presentation_heading_pair(objects, slide_width, slide_height)
    if headings is None:
        return []
    findings = []
    for role, item in (("title", headings[0]), ("subtitle", headings[1])):
        if item is None:
            continue
        paragraph = item.element.find("p:txBody/a:p", NS)
        assert paragraph is not None
        content = "".join(node.text or "" for node in paragraph.findall(".//a:t", NS)).strip()
        properties = paragraph.find("a:pPr", NS)
        decorative_bullet = content.startswith(("•", "▪", "●", "◦", "‣", "⁃", "·"))
        if properties is not None:
            decorative_bullet = decorative_bullet or any(
                properties.find(f"a:{kind}", NS) is not None
                for kind in ("buChar", "buAutoNum", "buBlip")
            )
        if decorative_bullet:
            findings.append(
                {
                    "kind": "decorative_bullet_in_presentation_heading",
                    "slide": slide_number,
                    "object_id": item.object_id,
                    "heading_role": role,
                }
            )
        abbreviation = re.search(
            r"(?:\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Inc|Ltd|Co|etc|vs)\.)$",
            content,
            flags=re.IGNORECASE,
        )
        if content.endswith(".") and abbreviation is None:
            findings.append(
                {
                    "kind": "presentation_heading_trailing_full_stop",
                    "slide": slide_number,
                    "object_id": item.object_id,
                    "heading_role": role,
                    "character_count": len(content),
                }
            )
    return findings


def _heading_fit_findings(
    slide_number: int, objects: list[SlideObject], slide_width: float, slide_height: float
) -> list[dict[str, Any]]:
    """Reject only proven bold-font title wrapping into an actual subtitle."""

    headings = _presentation_heading_pair(objects, slide_width, slide_height)
    if headings is None or headings[1] is None:
        return []
    title, subtitle = headings
    body = title.element.find("p:txBody/a:bodyPr", NS)
    if body is None or body.find("a:noAutofit", NS) is None or body.get("wrap", "square") == "none":
        return []
    paragraph = title.element.find("p:txBody/a:p", NS)
    assert paragraph is not None
    if paragraph.find("a:br", NS) is not None:
        return []
    runs = paragraph.findall("a:r", NS)
    if len(runs) != 1:
        return []
    properties = runs[0].find("a:rPr", NS)
    node = runs[0].find("a:t", NS)
    latin = properties.find("a:latin", NS) if properties is not None else None
    if (
        properties is None
        or node is None
        or latin is None
        or properties.get("b") != "1"
        or not properties.get("sz")
    ):
        return []
    family = latin.get("typeface", "").casefold().replace(" ", "")
    if family in {"arial", "arialmt"}:
        advances = _ARIAL_BOLD_ASCII_ADVANCES
    elif family in {"helveticaneue", "helveticaneue-bold"}:
        advances = _HELVETICA_NEUE_BOLD_ASCII_ADVANCES
    else:
        return []
    content = node.text or ""
    if len(content) < 30 or any(ord(value) < 32 or ord(value) > 126 for value in content):
        return []
    point_size = float(properties.get("sz", "0")) / 100.0
    usable_width = (
        title.box.width - float(body.get("lIns", 91440)) - float(body.get("rIns", 91440))
    ) / EMU_PER_POINT
    measured_width = sum(advances[ord(value) - 32] for value in content) * point_size / 1000.0
    if usable_width <= 0 or measured_width <= usable_width + 0.25:
        return []
    # A normal native word wrap needs at least two full lines. Only fail when
    # those actual font-aware lines physically enter the subtitle glyph band.
    actual_bottom = (
        title.box.y
        + float(body.get("tIns", DEFAULT_VERTICAL_MARGIN))
        + 2 * point_size * _paragraph_line_spacing(paragraph) * EMU_PER_POINT
    )
    subtitle_body = subtitle.element.find("p:txBody/a:bodyPr", NS)
    subtitle_top = subtitle.box.y + float(
        subtitle_body.get("tIns", DEFAULT_VERTICAL_MARGIN)
        if subtitle_body is not None
        else DEFAULT_VERTICAL_MARGIN
    )
    overlap = (actual_bottom - subtitle_top) / EMU_PER_POINT
    if overlap < 2.0:
        return []
    return [
        {
            "kind": "wrapped_presentation_title_subtitle_overlap",
            "slide": slide_number,
            "title_object_id": title.object_id,
            "subtitle_object_id": subtitle.object_id,
            "font_family": latin.get("typeface", ""),
            "font_size_pt": round(point_size, 2),
            "usable_width_pt": round(usable_width, 2),
            "measured_width_pt": round(measured_width, 2),
            "predicted_subtitle_overlap_pt": round(overlap, 2),
        }
    ]


def _text_overflow_findings(slide_number: int, objects: list[SlideObject]) -> list[dict[str, Any]]:
    """Reject proven one-line Arial overflow without exposing slide text."""

    findings = []
    for item in objects:
        if item.kind != "sp" or not item.has_text:
            continue
        body = item.element.find("p:txBody/a:bodyPr", NS)
        if (
            body is None
            or body.find("a:noAutofit", NS) is None
            or body.get("wrap", "square") == "none"
        ):
            continue
        paragraphs = item.element.findall("p:txBody/a:p", NS)
        if len(paragraphs) != 1 or paragraphs[0].find("a:br", NS) is not None:
            continue
        runs = paragraphs[0].findall("a:r", NS)
        if len(runs) != 1:
            continue
        properties = runs[0].find("a:rPr", NS)
        node = runs[0].find("a:t", NS)
        latin = properties.find("a:latin", NS) if properties is not None else None
        if (
            properties is None
            or node is None
            or latin is None
            or not properties.get("sz")
            or properties.get("b") == "1"
            or latin.get("typeface", "").casefold() not in {"arial", "arialmt"}
        ):
            continue
        content = node.text or ""
        if len(content) < 40 or any(ord(value) < 32 or ord(value) > 126 for value in content):
            continue
        font_size = float(properties.get("sz", "0")) / 100.0
        left = float(body.get("lIns", 91440))
        right = float(body.get("rIns", 91440))
        top = float(body.get("tIns", DEFAULT_VERTICAL_MARGIN))
        bottom = float(body.get("bIns", DEFAULT_VERTICAL_MARGIN))
        usable_width = (item.box.width - left - right) / EMU_PER_POINT
        usable_height = (item.box.height - top - bottom) / EMU_PER_POINT
        line_height = font_size * _paragraph_line_spacing(paragraphs[0])
        if (
            usable_width <= 0
            or usable_height < font_size * 0.9
            or usable_height >= line_height * 1.8
        ):
            continue
        measured_width = (
            sum(_ARIAL_ASCII_ADVANCES[ord(value) - 32] for value in content) * font_size / 1000.0
        )
        if measured_width <= usable_width * 1.03 + 1.0:
            continue
        findings.append(
            {
                "kind": "single_line_text_overflow",
                "slide": slide_number,
                "object_id": item.object_id,
                "font_family": "Arial",
                "font_size_pt": round(font_size, 2),
                "character_count": len(content),
                "usable_width_pt": round(usable_width, 2),
                "measured_width_pt": round(measured_width, 2),
                "usable_height_pt": round(usable_height, 2),
                "required_two_line_height_pt": round(line_height * 2, 2),
            }
        )
    return findings


def _dense_bold_paragraph_findings(
    slide_number: int, objects: list[SlideObject]
) -> list[dict[str, Any]]:
    """Find crowded multi-paragraph callouts without exposing their contents."""

    findings = []
    for item in objects:
        if item.kind != "sp" or not item.has_text:
            continue
        body = item.element.find("p:txBody/a:bodyPr", NS)
        if (
            body is None
            or body.find("a:noAutofit", NS) is None
            or body.get("wrap", "square") == "none"
        ):
            continue
        paragraphs = item.element.findall("p:txBody/a:p", NS)
        if not 2 <= len(paragraphs) <= 4:
            continue
        lengths = []
        sizes = []
        explicit_spacing = False
        for paragraph in paragraphs:
            runs = paragraph.findall("a:r", NS)
            if len(runs) != 1:
                break
            properties = runs[0].find("a:rPr", NS)
            node = runs[0].find("a:t", NS)
            if (
                properties is None
                or node is None
                or properties.get("b") != "1"
                or not properties.get("sz")
            ):
                break
            lengths.append(len(node.text or ""))
            sizes.append(float(properties.get("sz", "0")) / 100.0)
            paragraph_properties = paragraph.find("a:pPr", NS)
            explicit_spacing = explicit_spacing or (
                paragraph_properties is not None
                and (
                    paragraph_properties.find("a:spcAft", NS) is not None
                    or paragraph_properties.find("a:spcBef", NS) is not None
                )
            )
        if (
            len(lengths) != len(paragraphs)
            or sum(lengths) < 120
            or min(lengths) < 35
            or explicit_spacing
        ):
            continue
        usable_height = (
            item.box.height
            - float(body.get("tIns", DEFAULT_VERTICAL_MARGIN))
            - float(body.get("bIns", DEFAULT_VERTICAL_MARGIN))
        ) / EMU_PER_POINT
        if usable_height / sum(sizes) > 1.65:
            continue
        findings.append(
            {
                "kind": "dense_bold_paragraphs_without_spacing",
                "slide": slide_number,
                "object_id": item.object_id,
                "paragraph_count": len(paragraphs),
                "character_count": sum(lengths),
                "usable_height_pt": round(usable_height, 2),
            }
        )
    return findings


def _text_overlap_findings(slide_number: int, objects: list[SlideObject]) -> list[dict[str, Any]]:
    """Flag substantial sibling text-frame intersections without exporting text."""

    findings = []
    text_objects = [item for item in objects if item.kind == "sp" and item.has_text]
    for index, left in enumerate(text_objects):
        left_area = left.box.width * left.box.height
        if left_area <= 0:
            continue
        for right in text_objects[index + 1 :]:
            right_area = right.box.width * right.box.height
            if right_area <= 0:
                continue
            overlap_width = min(left.box.right, right.box.right) - max(left.box.x, right.box.x)
            overlap_height = min(left.box.bottom, right.box.bottom) - max(left.box.y, right.box.y)
            if overlap_width <= 0 or overlap_height <= 0:
                continue
            left_top, left_bottom = _occupied_text_vertical_band(left)
            right_top, right_bottom = _occupied_text_vertical_band(right)
            if min(left_bottom, right_bottom) <= max(left_top, right_top):
                continue
            left_start, left_end = _occupied_text_horizontal_band(left)
            right_start, right_end = _occupied_text_horizontal_band(right)
            if min(left_end, right_end) <= max(left_start, right_start):
                continue
            intersection = overlap_width * overlap_height
            if (
                intersection / min(left_area, right_area) < 0.42
                or intersection / max(left_area, right_area) < 0.16
            ):
                continue
            findings.append(
                {
                    "kind": "substantial_text_frame_overlap",
                    "slide": slide_number,
                    "left_object_id": left.object_id,
                    "right_object_id": right.object_id,
                    "overlap_height_in": round(overlap_height / EMU_PER_INCH, 4),
                    "overlap_width_in": round(overlap_width / EMU_PER_INCH, 4),
                }
            )
    return findings


def _repeated_wrapped_body_heading_overlap_findings(
    slide_number: int, objects: list[SlideObject]
) -> list[dict[str, Any]]:
    """Detect repeated wrapped-description collisions with following headings."""

    pairs = []
    text_objects = [item for item in objects if item.kind == "sp" and item.has_text]
    for body_item in text_objects:
        body = body_item.element.find("p:txBody/a:bodyPr", NS)
        if body is None or body.get("wrap", "square") == "none":
            continue
        paragraphs = body_item.element.findall("p:txBody/a:p", NS)
        if len(paragraphs) != 1:
            continue
        usable_width = (
            body_item.box.width - float(body.get("lIns", 91440)) - float(body.get("rIns", 91440))
        )
        if usable_width <= 0 or _paragraph_lines(paragraphs[0], usable_width) < 2:
            continue
        for heading_item in text_objects:
            if heading_item.object_id == body_item.object_id:
                continue
            if heading_item.box.y <= body_item.box.y:
                continue
            if abs(heading_item.box.x - body_item.box.x) > 2 * EMU_PER_POINT:
                continue
            overlap_height = body_item.box.bottom - heading_item.box.y
            if overlap_height < EMU_PER_POINT:
                continue
            overlap_width = min(body_item.box.right, heading_item.box.right) - max(
                body_item.box.x, heading_item.box.x
            )
            if overlap_width < min(body_item.box.width, heading_item.box.width) * 0.8:
                continue
            heading_body = heading_item.element.find("p:txBody/a:bodyPr", NS)
            if heading_body is None or heading_body.get("wrap", "square") != "none":
                continue
            heading_paragraphs = heading_item.element.findall("p:txBody/a:p", NS)
            if len(heading_paragraphs) != 1:
                continue
            properties = [run.find("a:rPr", NS) for run in heading_paragraphs[0].findall("a:r", NS)]
            if not properties or not all(
                value is not None and value.get("b") == "1" for value in properties
            ):
                continue
            pairs.append(
                {
                    "kind": "repeated_wrapped_body_heading_overlap",
                    "slide": slide_number,
                    "body_object_id": body_item.object_id,
                    "heading_object_id": heading_item.object_id,
                    "overlap_height_pt": round(overlap_height / EMU_PER_POINT, 2),
                }
            )
    return pairs if len(pairs) >= 2 else []


def _slide_boundary_findings(
    slide_number: int,
    objects: list[SlideObject],
    slide_width: float,
    slide_height: float,
) -> list[dict[str, Any]]:
    findings = []
    tolerance = EMU_PER_INCH * 0.005
    for item in objects:
        if (
            item.box.x < -tolerance
            or item.box.y < -tolerance
            or item.box.right > slide_width + tolerance
            or item.box.bottom > slide_height + tolerance
        ):
            findings.append(
                {
                    "kind": "object_outside_slide_boundary",
                    "slide": slide_number,
                    "object_id": item.object_id,
                    "object_kind": item.kind,
                }
            )
    return findings


def _font_size(paragraph: ET.Element) -> float:
    sizes = []
    for properties in paragraph.findall("a:r/a:rPr", NS):
        value = properties.get("sz")
        if value:
            sizes.append(float(value) / 100)
    default = paragraph.find("a:pPr/a:defRPr", NS)
    if default is not None and default.get("sz"):
        sizes.append(float(default.get("sz", "0")) / 100)
    return max(sizes, default=12.0)


def _paragraph_line_spacing(paragraph: ET.Element) -> float:
    spacing = paragraph.find("a:pPr/a:lnSpc/a:spcPct", NS)
    if spacing is not None and spacing.get("val"):
        return max(1.0, float(spacing.get("val", "100000")) / 100000)
    return 1.2


def _paragraph_lines(paragraph: ET.Element, usable_width: float) -> int:
    text = "".join(node.text or "" for node in paragraph.findall(".//a:t", NS))
    if not text:
        return 1
    size = _font_size(paragraph)
    average_glyph_width = max(1.0, size * EMU_PER_POINT * 0.54)
    characters_per_line = max(1, int(usable_width // average_glyph_width))
    return sum(max(1, math.ceil(len(line) / characters_per_line)) for line in text.split("\n"))


def _effective_row_height(row: ET.Element, columns: list[float]) -> float:
    declared = float(row.get("h", "0"))
    required = declared
    for index, cell in enumerate(row.findall("a:tc", NS)):
        properties = cell.find("a:tcPr", NS)
        margins = properties.attrib if properties is not None else {}
        top = float(margins.get("marT", DEFAULT_VERTICAL_MARGIN))
        bottom = float(margins.get("marB", DEFAULT_VERTICAL_MARGIN))
        left = float(margins.get("marL", 91440))
        right = float(margins.get("marR", 91440))
        width = columns[index] if index < len(columns) else EMU_PER_INCH
        usable_width = max(1.0, width - left - right)
        line_height = 0.0
        for paragraph in cell.findall("a:txBody/a:p", NS):
            line_height += (
                _paragraph_lines(paragraph, usable_width)
                * _font_size(paragraph)
                * EMU_PER_POINT
                * _paragraph_line_spacing(paragraph)
            )
        # Native PowerPoint's table engine reserves caret/baseline breathing
        # room beyond line-height plus margins; extrema are not hard clips.
        native_leading = max(EMU_PER_INCH * 0.07, line_height * 0.14)
        required = max(required, top + bottom + line_height + native_leading)
    return required


def _table_findings(
    slide_number: int, objects: list[SlideObject], slide_height: float
) -> list[dict[str, Any]]:
    findings = []
    for table_object in (
        item
        for item in objects
        if item.kind == "graphicFrame" and item.element.find(".//a:tbl", NS) is not None
    ):
        table = table_object.element.find(".//a:tbl", NS)
        assert table is not None
        rows = table.findall("a:tr", NS)
        columns = [
            float(column.get("w", "0")) for column in table.findall("a:tblGrid/a:gridCol", NS)
        ]
        declared_bottom = table_object.box.y + sum(float(row.get("h", "0")) for row in rows)
        estimated_bottom = table_object.box.y + sum(
            _effective_row_height(row, columns) for row in rows
        )
        lower_furniture = [
            item
            for item in objects
            if item.object_id != table_object.object_id
            and item.kind in {"sp", "pic"}
            and item.box.y >= slide_height * (1 - FOOTER_REGION)
            and item.box.y >= table_object.box.y
            and item.box.right > table_object.box.x
            and item.box.x < table_object.box.right
        ]
        boundary = min([slide_height] + [item.box.y for item in lower_furniture])
        if estimated_bottom > boundary:
            findings.append(
                {
                    "kind": "native_table_overflow",
                    "slide": slide_number,
                    "table_id": table_object.object_id,
                    "rows": len(rows),
                    "columns": len(columns),
                    "declared_bottom_in": round(declared_bottom / EMU_PER_INCH, 4),
                    "estimated_native_bottom_in": round(estimated_bottom / EMU_PER_INCH, 4),
                    "available_bottom_in": round(boundary / EMU_PER_INCH, 4),
                    "overflow_in": round((estimated_bottom - boundary) / EMU_PER_INCH, 4),
                    "footer_object_ids": [
                        item.object_id for item in lower_furniture if item.box.y < estimated_bottom
                    ],
                }
            )
    return findings


def _slide_parts(package: zipfile.ZipFile, presentation: ET.Element) -> list[str]:
    try:
        relationships = ET.fromstring(package.read("ppt/_rels/presentation.xml.rels"))
    except KeyError:
        return sorted(
            (
                name
                for name in package.namelist()
                if name.startswith("ppt/slides/slide")
                and name.endswith(".xml")
                and "/_rels/" not in name
            ),
            key=lambda name: int(name.removeprefix("ppt/slides/slide").removesuffix(".xml")),
        )
    by_id = {
        item.get("Id", ""): item.get("Target", "")
        for item in relationships.findall("pr:Relationship", NS)
    }
    result = []
    for slide in presentation.findall("p:sldIdLst/p:sldId", NS):
        relation_id = slide.get(f"{{{NS['r']}}}id", "")
        target = by_id.get(relation_id)
        if not target:
            raise ValueError("presentation slide relationship is missing")
        if target.startswith("/"):
            part = posixpath.normpath(target.lstrip("/"))
        else:
            part = posixpath.normpath(posixpath.join("ppt", target))
        result.append(part)
    return result


def _presentation_policy_findings(
    package: zipfile.ZipFile,
    presentation: ET.Element,
    parts: list[str],
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply only explicitly frozen task/template geometry and cover rules."""

    findings = []
    size = presentation.find("p:sldSz", NS)
    if size is None:
        raise ValueError("presentation has no slide dimensions")
    width = int(size.get("cx", "0"))
    height = int(size.get("cy", "0"))
    if width <= 0 or height <= 0:
        raise ValueError("presentation slide dimensions must be positive")

    aspect = policy.get("expected_aspect")
    if aspect:
        try:
            numerator, denominator = (int(value) for value in aspect.split(":"))
        except (TypeError, ValueError) as exc:
            raise ValueError("expected aspect must use positive N:D") from exc
        if numerator <= 0 or denominator <= 0:
            raise ValueError("expected aspect must use positive N:D")
        if abs(width / height - numerator / denominator) > 0.02:
            findings.append(
                {
                    "kind": "unexpected_slide_aspect_ratio",
                    "expected_aspect": aspect,
                    "actual_cx_emu": width,
                    "actual_cy_emu": height,
                }
            )

    expected_size = policy.get("expected_slide_size_emu")
    if expected_size:
        try:
            expected_width, expected_height = (int(value) for value in expected_size.split(","))
        except (TypeError, ValueError) as exc:
            raise ValueError("expected slide size must use positive CX,CY") from exc
        if expected_width <= 0 or expected_height <= 0:
            raise ValueError("expected slide size must use positive CX,CY")
        if (width, height) != (expected_width, expected_height):
            findings.append(
                {
                    "kind": "approved_template_slide_size_changed",
                    "expected_cx_emu": expected_width,
                    "expected_cy_emu": expected_height,
                    "actual_cx_emu": width,
                    "actual_cy_emu": height,
                }
            )

    expected_count = policy.get("expected_slide_count")
    if expected_count is not None and len(parts) != expected_count:
        findings.append(
            {
                "kind": "requested_slide_count_changed",
                "expected_slide_count": expected_count,
                "actual_slide_count": len(parts),
            }
        )

    required_table_slides = policy.get("require_native_table_slides", [])
    if any(number < 1 or number > len(parts) for number in required_table_slides):
        raise ValueError("required native table slide numbers must identify actual slides")
    for number in sorted(set(required_table_slides)):
        required_slide = ET.fromstring(package.read(parts[number - 1]))
        if required_slide.find(".//a:tbl", NS) is None:
            findings.append(
                {
                    "kind": "required_native_table_missing",
                    "slide": number,
                }
            )

    editorial_slides = policy.get("require_editorial_slides", [])
    if any(number < 1 or number > len(parts) for number in editorial_slides):
        raise ValueError("required editorial slide numbers must identify actual slides")
    approved_bullet_slides = policy.get("approved_bullet_slides", [])
    if any(number < 1 or number > len(parts) for number in approved_bullet_slides):
        raise ValueError("approved bullet slide numbers must identify actual slides")
    approved_heading_slides = policy.get("approved_heading_slides", [])
    if any(number < 1 or number > len(parts) for number in approved_heading_slides):
        raise ValueError("approved heading slide numbers must identify actual slides")

    role = policy.get("cover_role", "none")
    if role not in {"cover", "explicit_hybrid"} or not parts:
        return findings
    root = ET.fromstring(package.read(parts[0]))
    word_count = sum(
        len(
            re.findall(
                r"\b[\w’'-]+\b",
                " ".join(node.text or "" for node in shape.findall(".//a:t", NS)),
            )
        )
        for shape in root.findall(".//p:sp", NS)
    )
    limit = policy.get("cover_word_limit")
    if limit is None:
        limit = 45 if role == "cover" else 75
    if word_count > limit:
        findings.append(
            {
                "kind": "cover_prose_density_exceeded",
                "slide": 1,
                "role": role,
                "word_count": word_count,
                "word_limit": limit,
            }
        )
    if not policy.get("allow_cover_table") and root.find(".//a:tbl", NS) is not None:
        findings.append({"kind": "unapproved_cover_table", "slide": 1})
    if not policy.get("allow_cover_chart") and root.find(".//c:chart", NS) is not None:
        findings.append({"kind": "unapproved_cover_chart", "slide": 1})
    return findings


def _uniform_presentation_font_findings(
    package: zipfile.ZipFile, parts: list[str]
) -> list[dict[str, Any]]:
    """Compare only typefaces actually declared in audience-facing content."""

    theme_families: dict[str, str] = {}
    theme_parts = sorted(
        name
        for name in package.namelist()
        if name.startswith("ppt/theme/theme") and name.endswith(".xml")
    )
    if len(theme_parts) == 1:
        theme = ET.fromstring(package.read(theme_parts[0]))
        for alias, path in (
            ("+mj-lt", ".//a:majorFont/a:latin"),
            ("+mn-lt", ".//a:minorFont/a:latin"),
        ):
            element = theme.find(path, NS)
            if element is not None and element.get("typeface", "").strip():
                theme_families[alias] = element.get("typeface", "").strip()

    observed: dict[str, str] = {}
    audience_parts = [
        *parts,
        *sorted(
            name
            for name in package.namelist()
            if name.startswith("ppt/")
            and "/charts/" in name
            and name.endswith(".xml")
            and "/_rels/" not in name
        ),
    ]
    for part in audience_parts:
        root = ET.fromstring(package.read(part))
        for element in root.findall(".//a:latin", NS):
            family = element.get("typeface", "").strip()
            if not family:
                continue
            if family.startswith("+"):
                family = theme_families.get(family, "")
                if not family:
                    continue
            normalized = re.sub(r"[\s_-]+", " ", family).strip().casefold()
            if normalized == "arialmt":
                normalized = "arial"
            observed.setdefault(normalized, family)

    if len(observed) <= 1:
        return []
    return [
        {
            "kind": "inconsistent_presentation_font_family",
            "font_family_count": len(observed),
            "font_families": sorted(observed.values(), key=str.casefold),
        }
    ]


def _font_key(family: str) -> str:
    value = re.sub(r"^[A-Z]{6}\+", "", family.strip())
    value = re.sub(
        r"-(?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman)(?:MT)?$",
        "",
        value,
        flags=re.I,
    )
    value = re.sub(r"[\s_-]+", " ", value).casefold()
    return {"arialmt": "arial", "helveticaneue": "helvetica neue"}.get(value, value)


def _text_scripts(text: str) -> set[str]:
    """A non-Latin fallback never exempts ordinary Latin text or numbers."""
    scripts: set[str] = set()
    for character in text:
        if character.isspace():
            continue
        code = ord(character)
        if (
            0x2E80 <= code <= 0xA4CF
            or 0xAC00 <= code <= 0xD7AF
            or 0xF900 <= code <= 0xFAFF
            or 0xFF01 <= code <= 0xFF60
            or 0x20000 <= code <= 0x323AF
        ):
            scripts.add("ea")
        elif 0x0590 <= code <= 0x109F or 0xFB1D <= code <= 0xFEFF:
            scripts.add("cs")
        elif code >= 0x1F000 or (code > 0x7F and unicodedata.category(character) == "So"):
            scripts.add("symbol")
        elif unicodedata.category(character)[0] in {"L", "N"} or code < 0x80:
            scripts.add("latin")
    return scripts or ({"latin"} if text.strip() else set())


def inspect_presentation_font_policy(
    package: zipfile.ZipFile, parts: list[str], policy: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Check used editable text, resolving its own slide/layout/master theme.

    No text, prompts or source contents are emitted. A reference inventory uses
    encoded, non-hidden text, not a generated file or an unused theme family.
    """
    from native_quantitative_chart_gate import _relationships, _safe_xml

    inventory_only = policy.get("font_inventory_only") is True
    required = policy.get("required_default_font_family")
    approved = policy.get("approved_font_families", [])
    if required and approved:
        raise ValueError("Default and source font policies cannot be mixed")
    families = [required] if required else approved
    if (
        (not families and not inventory_only)
        or len(families) > 16
        or any(
            not isinstance(name, str)
            or not name.strip()
            or len(name) > 128
            or re.search(r"[\x00-\x1f\x7f]", name)
            for name in families
        )
    ):
        raise ValueError("Font policy needs bounded explicit families")
    allowed = {_font_key(name) for name in families}
    script_fonts: dict[str, str] = {}
    for entry in policy.get("approved_script_fonts", []):
        script, separator, family = entry.partition("=")
        if (
            separator != "="
            or script not in {"ea", "cs", "symbol"}
            or script in script_fonts
            or not family.strip()
            or len(family) > 128
        ):
            raise ValueError("Invalid or repeated script-specific font approval")
        script_fonts[script] = _font_key(family)
    roots: dict[str, ET.Element] = {}
    relations: dict[str, dict[str, Any]] = {}
    visible_by_part: dict[str, list[ET.Element]] = {}

    def root(part: str) -> ET.Element:
        if part not in roots:
            roots[part] = _safe_xml(package, part)
        return roots[part]

    def rels(part: str) -> dict[str, Any]:
        if part not in relations:
            relations[part] = _relationships(package, part)
        return relations[part]

    def related(part: str, kind: str) -> str | None:
        selected = [value for value in rels(part).values() if value["type"].endswith("/" + kind)]
        if len(selected) > 1 or any(value["mode"] != "Internal" for value in selected):
            raise ValueError("Ambiguous or external font inheritance relationship")
        if not selected:
            return None
        target = selected[0]["target"]
        root(target)  # Missing or malformed inheritance cannot silently pass.
        return target

    def visible_elements(part: str) -> list[ET.Element]:
        # Hidden shapes and entire hidden groups are not audience-facing text.
        # Their stored typography must neither block output nor approve a font
        # that the supplied reference never actually shows.
        if part not in visible_by_part:
            visible: list[ET.Element] = []
            stack = [root(part)]
            containers = {
                "sp": "nvSpPr",
                "cxnSp": "nvCxnSpPr",
                "grpSp": "nvGrpSpPr",
                "graphicFrame": "nvGraphicFramePr",
                "pic": "nvPicPr",
            }
            while stack:
                element = stack.pop()
                container = containers.get(_local(element))
                properties = element.find(f"p:{container}/p:cNvPr", NS) if container else None
                if properties is not None and properties.get("hidden", "0").lower() in {
                    "1",
                    "true",
                }:
                    continue
                visible.append(element)
                stack.extend(reversed(list(element)))
            visible_by_part[part] = visible
        return visible_by_part[part]

    def font_element(properties: ET.Element | None, script: str) -> str | None:
        if properties is None:
            return None
        tag = "sym" if script == "symbol" else script
        element = properties.find("a:" + tag, NS)
        if element is None or not element.get("typeface", "").strip():
            return None
        return element.get("typeface", "").strip()

    findings: list[dict[str, Any]] = []
    observed: dict[str, int] = {}
    checked = 0
    for slide_number, slide_part in enumerate(parts, 1):
        slide = root(slide_part)
        layout_part = related(slide_part, "slideLayout")
        master_part = related(layout_part, "slideMaster") if layout_part else None
        chain = [
            part for part in (slide_part, layout_part, master_part, "ppt/presentation.xml") if part
        ]
        theme_part = next((theme for part in chain if (theme := related(part, "theme"))), None)
        theme = root(theme_part) if theme_part else None
        master = root(master_part) if master_part else None
        presentation = root("ppt/presentation.xml")

        def resolve(
            family: str | None, script: str, language: str = "", *, theme: ET.Element | None = theme
        ) -> str | None:
            if family and not family.startswith("+"):
                return family
            if family and not re.fullmatch(r"\+m[jn]-(lt|ea|cs)", family):
                return None
            if theme is None:
                return None
            role = "majorFont" if family and family.startswith("+mj") else "minorFont"
            tag = {"lt": "latin", "ea": "ea", "cs": "cs"}.get(
                family.rsplit("-", 1)[-1] if family else "",
                {"latin": "latin", "ea": "ea", "cs": "cs", "symbol": "latin"}[script],
            )
            scheme = theme.find(f".//a:fontScheme/a:{role}", NS)
            element = scheme.find(f"a:{tag}", NS) if scheme is not None else None
            if element is not None and element.get("typeface", "").strip():
                return element.get("typeface", "").strip()
            # A theme often leaves ea/cs empty and uses script-specific entries.
            # Resolve only a unique applicable family; never guess among scripts.
            scripts = (
                {"Jpan", "Hans", "Hant", "Hang"}
                if tag == "ea"
                else {
                    "Arab",
                    "Hebr",
                    "Deva",
                    "Beng",
                    "Guru",
                    "Gujr",
                    "Orya",
                    "Taml",
                    "Telu",
                    "Knda",
                    "Mlym",
                    "Thai",
                    "Laoo",
                    "Mymr",
                }
                if tag == "cs"
                else set()
            )
            language = language.lower()
            if tag == "ea":
                if language.startswith("ja"):
                    scripts = {"Jpan"}
                elif language.startswith("ko"):
                    scripts = {"Hang"}
                elif language.startswith("zh"):
                    scripts = {
                        "Hant"
                        if any(value in language for value in ("tw", "hk", "hant"))
                        else "Hans"
                    }
            elif tag == "cs":
                mapped_script = {
                    "ar": "Arab",
                    "he": "Hebr",
                    "hi": "Deva",
                    "bn": "Beng",
                    "th": "Thai",
                }.get(language.split("-")[0])
                if mapped_script:
                    scripts = {mapped_script}
            mapped = (
                {
                    entry.get("typeface", "").strip()
                    for entry in scheme.findall("a:font", NS)
                    if entry.get("script") in scripts and entry.get("typeface", "").strip()
                }
                if scheme is not None
                else set()
            )
            return next(iter(mapped)) if len(mapped) == 1 else None

        def check(
            properties: list[ET.Element | None],
            scripts: set[str],
            object_id: str,
            reference: str | None = None,
            *,
            slide_number: int = slide_number,
        ) -> None:
            nonlocal checked
            for script in sorted(scripts):
                checked += 1
                family = next(
                    (name for item in properties if (name := font_element(item, script))), None
                )
                if family is None and reference in {"major", "minor"}:
                    # A Latin font declaration does not define East Asian or
                    # complex-script glyphs governed by this shape's theme.
                    suffix = {"latin": "lt", "ea": "ea", "cs": "cs", "symbol": "lt"}[script]
                    family = f"+m{'j' if reference == 'major' else 'n'}-{suffix}"
                elif family is None and script != "latin":
                    family = next(
                        (name for item in properties if (name := font_element(item, "latin"))), None
                    )
                language = next(
                    (
                        item.get("lang")
                        for item in properties
                        if item is not None and item.get("lang")
                    ),
                    "",
                )
                effective = resolve(family, script, language)
                if effective:
                    observed[effective] = observed.get(effective, 0) + 1
                valid = bool(effective) and (
                    inventory_only
                    or _font_key(effective) in allowed
                    or (script != "latin" and _font_key(effective) == script_fonts.get(script))
                )
                if not valid:
                    findings.append(
                        {
                            "kind": "unapproved_presentation_font"
                            if effective
                            else "unresolved_presentation_font",
                            "slide": slide_number,
                            "object_id": object_id,
                            "script": script,
                            "font_family": effective,
                        }
                    )

        def paragraphs(
            body: ET.Element,
            shape: ET.Element | None,
            inherited: list[ET.Element],
            object_id: str,
            extra_defaults: list[ET.Element | None] | None = None,
            *,
            master: ET.Element | None = master,
            presentation: ET.Element = presentation,
        ) -> None:
            placeholder = shape.find("p:nvSpPr/p:nvPr/p:ph", NS) if shape is not None else None
            placeholder_type = (
                placeholder.get("type", "body") if placeholder is not None else "other"
            )
            style_role = (
                "titleStyle"
                if placeholder_type in {"title", "ctrTitle"}
                else "bodyStyle"
                if placeholder_type == "body"
                else "otherStyle"
            )
            font_ref = shape.find("p:style/a:fontRef", NS) if shape is not None else None
            reference = (
                font_ref.get("idx")
                if font_ref is not None and font_ref.get("idx") in {"major", "minor"}
                else None
            )
            for paragraph in body.findall("a:p", NS):
                paragraph_properties = paragraph.find("a:pPr", NS)
                level = (
                    int(paragraph_properties.get("lvl", "0")) + 1
                    if paragraph_properties is not None
                    else 1
                )
                if not 1 <= level <= 9:
                    raise ValueError("Invalid paragraph font inheritance level")
                base = [
                    paragraph.find("a:pPr/a:defRPr", NS),
                    body.find(f"a:lstStyle/a:lvl{level}pPr/a:defRPr", NS),
                    body.find("a:lstStyle/a:defPPr/a:defRPr", NS),
                ]
                for ancestor in inherited:
                    base.extend(
                        [
                            ancestor.find("p:txBody/a:p/a:pPr/a:defRPr", NS),
                            ancestor.find(f"p:txBody/a:lstStyle/a:lvl{level}pPr/a:defRPr", NS),
                        ]
                    )
                base.extend(extra_defaults or [])
                if master is not None:
                    base.append(
                        master.find(f"p:txStyles/p:{style_role}/a:lvl{level}pPr/a:defRPr", NS)
                    )
                base.append(presentation.find(f"p:defaultTextStyle/a:lvl{level}pPr/a:defRPr", NS))
                for run in list(paragraph):
                    if _local(run) not in {"r", "fld"}:
                        continue
                    text = "".join(node.text or "" for node in run.findall("a:t", NS))
                    scripts = _text_scripts(text)
                    if scripts:
                        check([run.find("a:rPr", NS), *base], scripts, object_id, reference)

        displayed_parts = [slide_part]
        if slide.get("showMasterSp", "1").lower() not in {"0", "false"}:
            for part in (layout_part, master_part):
                if part and not (
                    part == master_part
                    and layout_part
                    and root(layout_part).get("showMasterSp", "1").lower() in {"0", "false"}
                ):
                    displayed_parts.append(part)
        visible_shapes = [
            shape
            for part in displayed_parts
            for shape in visible_elements(part)
            if shape.tag in {f"{{{NS['p']}}}sp", f"{{{NS['p']}}}cxnSp"}
            and (part == slide_part or shape.find("p:nvSpPr/p:nvPr/p:ph", NS) is None)
        ]
        for shape in visible_shapes:
            body = shape.find("p:txBody", NS)
            if body is None:
                continue
            inherited: list[ET.Element] = []
            placeholder = shape.find("p:nvSpPr/p:nvPr/p:ph", NS)
            if placeholder is not None:
                for part in (layout_part, master_part):
                    if not part:
                        continue
                    matches = []
                    for ancestor in root(part).findall(".//p:sp", NS):
                        ph = ancestor.find("p:nvSpPr/p:nvPr/p:ph", NS)

                        def role(element: ET.Element) -> str:
                            value = element.get("type", "body")
                            return "title" if value in {"title", "ctrTitle"} else value

                        if (
                            ph is not None
                            and ph.get("idx", "0") == placeholder.get("idx", "0")
                            and role(ph) == role(placeholder)
                        ):
                            matches.append(ancestor)
                    if len(matches) > 1:
                        raise ValueError("Ambiguous placeholder font inheritance")
                    inherited.extend(matches)
            paragraphs(body, shape, inherited, _object_id(shape))
        table_bodies = [
            body
            for part in displayed_parts
            for element in visible_elements(part)
            if element.tag == f"{{{NS['a']}}}tc"
            and (body := element.find("a:txBody", NS)) is not None
        ]
        for cell_number, body in enumerate(table_bodies, 1):
            paragraphs(body, None, [], f"table-cell-{cell_number}")
        chart_references = [
            (part, element)
            for part in displayed_parts
            for element in visible_elements(part)
            if element.tag == f"{{{NS['c']}}}chart"
        ]
        for owner_part, chart_reference in chart_references:
            relation = rels(owner_part).get(chart_reference.get("{" + NS["r"] + "}id", ""))
            if (
                not relation
                or relation["mode"] != "Internal"
                or not relation["type"].endswith("/chart")
            ):
                raise ValueError("Missing or external chart font relationship")
            chart = root(relation["target"])

            def chart_defaults(style: ET.Element | None) -> list[ET.Element | None]:
                if style is None:
                    return []
                return [
                    style.find("a:p/a:pPr/a:defRPr", NS),
                    style.find("a:lstStyle/a:lvl1pPr/a:defRPr", NS),
                    style.find("a:lstStyle/a:defPPr/a:defRPr", NS),
                ]

            global_defaults = chart_defaults(chart.find("c:txPr", NS))
            for rich in chart.findall(".//c:rich", NS):
                paragraphs(rich, None, [], "chart-rich-text", global_defaults)
            label_styles = chart.findall(".//c:txPr", NS)
            if not label_styles:
                check([], {"latin"}, "chart-label-default")
            for style in label_styles:
                paragraphs(style, None, [], "chart-label-text", global_defaults)
                check([*chart_defaults(style), *global_defaults], {"latin"}, "chart-label-style")

    return findings, {
        "performed": True,
        "passed": not findings,
        "checked_text_script_count": checked,
        "observed_font_families": sorted(observed, key=str.casefold),
        "observed_font_use_counts": observed,
        "native_font_rendering_verified": False,
    }


def inspect_reference_font_families(path: Path) -> dict[str, Any]:
    """Read fonts used by editable PPTX text or actual PDF text-show content."""
    if path.suffix.lower() == ".pptx":
        with zipfile.ZipFile(path) as package:
            presentation = ET.fromstring(package.read("ppt/presentation.xml"))
            parts = _slide_parts(package, presentation)
            findings, report = inspect_presentation_font_policy(
                package, parts, {"font_inventory_only": True}
            )
        if findings:
            raise ValueError(
                "Source typography has unresolved font inheritance; inspect it before declaring an exception"
            )
        fonts = report["observed_font_families"]
    elif path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path, strict=True)
        if reader.is_encrypted or not 0 < len(reader.pages) <= 9999:
            raise ValueError("Typography reference PDF must be readable and bounded")
        used: set[str] = set()
        render_mode = 0
        modes: list[int] = []

        def operand(operator, arguments, _cm, _tm):
            nonlocal render_mode
            if operator == b"q":
                modes.append(render_mode)
            elif operator == b"Q" and modes:
                render_mode = modes.pop()
            elif operator == b"Tr" and arguments:
                render_mode = int(arguments[0])

        def visitor(text, _cm, _tm, font, _size):
            if not text.strip() or render_mode in {3, 7}:
                return
            if not font:
                raise ValueError("PDF text has no resolvable font dictionary")
            descriptor = font.get("/FontDescriptor", {})
            if hasattr(descriptor, "get_object"):
                descriptor = descriptor.get_object()
            family = str(descriptor.get("/FontFamily") or font.get("/BaseFont") or "").lstrip("/")
            if not family:
                raise ValueError("PDF text has no resolvable font family")
            used.add(family)

        for page in reader.pages:
            render_mode = 0
            modes.clear()
            page.extract_text(visitor_operand_before=operand, visitor_text=visitor)
        fonts = sorted(used, key=str.casefold)
    else:
        raise ValueError("Typography reference must be PPTX or PDF")
    if not fonts:
        raise ValueError(
            "Reference has no inspectable text fonts; image-only font identity needs explicit user confirmation"
        )
    return {
        "font_families": fonts,
        "normalized_font_families": sorted({_font_key(font) for font in fonts}),
        "reference_type": path.suffix.lower()[1:],
        "native_rendering_verified": False,
    }


def _redundant_chart_findings(
    package: zipfile.ZipFile,
    slide_part: str,
    root: ET.Element,
    slide_number: int,
    allowed_count: int,
) -> list[dict[str, Any]]:
    """Find multiple native charts whose complete evidence repeats a native table."""

    tables = root.findall(".//a:tbl", NS)
    charts = root.findall(".//p:graphicFrame//c:chart", NS)
    if not tables or len(charts) <= allowed_count:
        return []
    values = set()
    for table in tables:
        for cell in table.findall(".//a:tc", NS):
            content = "".join(node.text or "" for node in cell.findall(".//a:t", NS)).strip()
            match = re.fullmatch(
                r"\s*\$?\(?[-−+]?(\d[\d,]*(?:\.\d+)?)\)?\s*(%)?\s*",
                content,
            )
            if match is None:
                continue
            try:
                value = Decimal(match.group(1).replace(",", ""))
            except InvalidOperation:
                continue
            values.add(value)
            if match.group(2):
                values.add(value / 100)
    if not values:
        return []
    relations_path = posixpath.join(
        posixpath.dirname(slide_part),
        "_rels",
        posixpath.basename(slide_part) + ".rels",
    )
    try:
        relationships = ET.fromstring(package.read(relations_path))
    except (KeyError, ET.ParseError):
        return []
    targets = {
        relation.get("Id", ""): relation.get("Target", "")
        for relation in relationships.findall("pr:Relationship", NS)
    }
    redundant = 0
    for chart in charts:
        target = targets.get(chart.get(f"{{{NS['r']}}}id", ""))
        if not target:
            continue
        part = (
            posixpath.normpath(target.lstrip("/"))
            if target.startswith("/")
            else posixpath.normpath(posixpath.join(posixpath.dirname(slide_part), target))
        )
        if not part.startswith("ppt/"):
            continue
        try:
            chart_root = ET.fromstring(package.read(part))
        except (KeyError, ET.ParseError):
            continue
        points = []
        for series in chart_root.findall(".//c:ser", NS):
            for value in series.findall("c:val//c:numCache/c:pt/c:v", NS):
                try:
                    points.append(Decimal(value.text))
                except (InvalidOperation, TypeError):
                    continue
        if len(points) >= 3 and all(point in values for point in points):
            redundant += 1
    if redundant <= allowed_count:
        return []
    return [
        {
            "kind": "redundant_charts_duplicate_table",
            "slide": slide_number,
            "duplicate_chart_count": redundant,
            "allowed_duplicate_count": allowed_count,
        }
    ]


def _folio_findings(
    slide_number: int,
    objects: list[SlideObject],
    slide_height: float,
) -> list[dict[str, Any]]:
    """Validate actual-index content folios only under an explicit task policy."""

    if slide_number == 1:
        return []
    candidates = []
    for item in objects:
        if not item.has_text or item.box.bottom < slide_height * (1 - FOOTER_REGION):
            continue
        value = " ".join(
            (node.text or "").strip() for node in item.element.findall(".//a:t", NS)
        ).strip()
        match = re.fullmatch(r"(?:page\s*)?(\d{1,4})(?:\s*/\s*\d{1,4})?", value, re.I)
        if match is None:
            continue
        raw = match.group(1)
        candidates.append((raw, int(raw), item.object_id))
        if int(raw) == slide_number:
            if len(raw) > 1 and raw.startswith("0"):
                return [
                    {
                        "kind": "zero_padded_slide_folio",
                        "slide": slide_number,
                        "object_id": item.object_id,
                    }
                ]
            return []
    return [
        {
            "kind": "incorrect_or_missing_actual_slide_folio",
            "slide": slide_number,
            "numeric_footer_candidate_count": len(candidates),
        }
    ]


def _monochrome_transparent_png(blob: bytes) -> bool:
    """Conservatively classify small alpha icon bitmaps without Pillow."""

    if len(blob) < 33 or blob[:8] != b"\x89PNG\r\n\x1a\n" or blob[12:16] != b"IHDR":
        return False
    width, height, depth, color = struct.unpack(">IIBB", blob[16:26])
    if not (
        1 <= width <= 256
        and 1 <= height <= 256
        and width * height <= 65536
        and depth == 8
        and color == 6
    ):
        return False
    cursor = 8
    compressed = []
    while cursor + 12 <= len(blob):
        length = struct.unpack(">I", blob[cursor : cursor + 4])[0]
        kind = blob[cursor + 4 : cursor + 8]
        if length > 1048576 or cursor + 12 + length > len(blob):
            return False
        if kind == b"IDAT":
            compressed.append(blob[cursor + 8 : cursor + 8 + length])
        cursor += 12 + length
        if kind == b"IEND":
            break
    expected_length = height * (1 + 4 * width)
    try:
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(b"".join(compressed), expected_length + 1)
    except zlib.error:
        return False
    if len(raw) != expected_length or decompressor.unconsumed_tail:
        return False
    previous = bytearray(4 * width)
    colors = set()
    transparent = 0
    stride = 1 + 4 * width
    for row in range(height):
        filter_type = raw[row * stride]
        current = bytearray(raw[row * stride + 1 : (row + 1) * stride])
        if filter_type > 4:
            return False
        for index in range(len(current)):
            left = current[index - 4] if index >= 4 else 0
            above = previous[index]
            diagonal = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                predicted = left
            elif filter_type == 2:
                predicted = above
            elif filter_type == 3:
                predicted = (left + above) // 2
            elif filter_type == 4:
                estimate = left + above - diagonal
                pa, pb, pc = (
                    abs(estimate - left),
                    abs(estimate - above),
                    abs(estimate - diagonal),
                )
                predicted = left if pa <= pb and pa <= pc else above if pb <= pc else diagonal
            else:
                predicted = 0
            current[index] = (current[index] + predicted) & 255
        for index in range(0, len(current), 4):
            alpha = current[index + 3]
            if alpha <= 5:
                transparent += 1
            elif alpha >= 128:
                colors.add(bytes(current[index : index + 3]))
                if len(colors) > 3:
                    return False
        previous = current
    return bool(colors) and transparent >= width * height * 0.12


def _slide_relationship_targets(package: zipfile.ZipFile, slide_part: str) -> dict[str, str]:
    path = posixpath.join(
        posixpath.dirname(slide_part),
        "_rels",
        posixpath.basename(slide_part) + ".rels",
    )
    try:
        root = ET.fromstring(package.read(path))
    except (KeyError, ET.ParseError):
        return {}
    return {
        entry.get("Id", ""): entry.get("Target", "")
        for entry in root.findall("pr:Relationship", NS)
    }


def _decorative_icon_findings(
    package: zipfile.ZipFile,
    parts: list[str],
    slide_width: float,
    slide_height: float,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    """Reject invented pictogram programs while preserving authorized assets."""

    approved_hashes = {value.lower() for value in policy.get("approved_image_sha256", [])}
    if any(re.fullmatch(r"[0-9a-f]{64}", value) is None for value in approved_hashes):
        raise ValueError("approved image hashes must be exact SHA-256 values")
    approved_slides = set(policy.get("approved_icon_slides", []))
    if any(number < 1 for number in approved_slides):
        raise ValueError("approved icon slide numbers must be positive")
    findings = []
    zones: dict[str, set[int]] = {
        "header": set(),
        "body_gutter": set(),
        "left_body_gutter": set(),
    }
    explicitly_named_native_icon_slides: set[int] = set()
    explicitly_named_native_cover_icon: str | None = None
    cache: dict[str, bool] = {}
    pending_native_cover: str | None = None
    for slide_number, part in enumerate(parts, start=1):
        if slide_number in approved_slides:
            continue
        root = ET.fromstring(package.read(part))
        targets = _slide_relationship_targets(package, part)
        monochrome_count = 0
        cover_flagged = False
        native_header_candidates: list[SlideObject] = []
        for item in _slide_objects(root):
            if item.has_text or item.kind not in {"pic", "sp"}:
                continue
            is_picture = item.kind == "pic"
            if not is_picture:
                properties = item.element.find("p:nvSpPr/p:cNvPr", NS)
                object_name = (
                    properties.get("name", "").strip().casefold() if properties is not None else ""
                )
                if object_name.startswith("icon-"):
                    if slide_number == 1:
                        explicitly_named_native_cover_icon = item.object_id
                    else:
                        explicitly_named_native_icon_slides.add(slide_number)
            if is_picture:
                blip = item.element.find("p:blipFill/a:blip", NS)
                if blip is None:
                    continue
                target = targets.get(blip.get(f"{{{NS['r']}}}embed", ""))
                if not target:
                    continue
                media_part = (
                    posixpath.normpath(target.lstrip("/"))
                    if target.startswith("/")
                    else posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
                )
                if not media_part.startswith("ppt/media/"):
                    continue
                try:
                    blob = package.read(media_part)
                except KeyError:
                    continue
                digest = hashlib.sha256(blob).hexdigest()
                if digest in approved_hashes:
                    continue
                if digest not in cache:
                    cache[digest] = _monochrome_transparent_png(blob)
                if not cache[digest]:
                    continue
            else:
                custom = item.element.find("p:spPr/a:custGeom", NS)
                preset = item.element.find("p:spPr/a:prstGeom", NS)
                if custom is None and (
                    preset is None or preset.get("prst") not in {"ellipse", "donut"}
                ):
                    continue

            x = item.box.x / slide_width
            y = item.box.y / slide_height
            area = item.box.width * item.box.height / (slide_width * slide_height)
            if is_picture and 0.0005 <= area <= 0.05:
                monochrome_count += 1
            if slide_number == 1:
                if not cover_flagged:
                    if is_picture and x >= 0.65 and y <= 0.55 and 0.008 <= area <= 0.06:
                        findings.append(
                            {
                                "kind": "unapproved_decorative_cover_icon",
                                "slide": 1,
                                "object_id": item.object_id,
                            }
                        )
                        cover_flagged = True
                    elif (
                        not is_picture
                        and (x <= 0.30 or x >= 0.65)
                        and 0.08 <= y <= 0.65
                        and 0.0015 <= area <= 0.06
                    ):
                        pending_native_cover = item.object_id
                        cover_flagged = True
                continue
            if x >= 0.74 and y <= 0.22 and 0.0012 <= area <= 0.04:
                if is_picture:
                    zones["header"].add(slide_number)
                else:
                    native_header_candidates.append(item)
            elif is_picture and x >= 0.72 and 0.22 <= y <= 0.48 and 0.008 <= area <= 0.05:
                zones["body_gutter"].add(slide_number)
            elif is_picture and x <= 0.16 and 0.24 <= y <= 0.55 and 0.0008 <= area <= 0.012:
                # A recurring tiny monochrome pictogram in the left body gutter
                # is decorative even when its peer is not in the right header.
                # Authentic photographs, approved hashes/slides, native diagrams,
                # isolated icons, and meaningful rating rows remain unaffected.
                zones["left_body_gutter"].add(slide_number)
        if native_header_candidates:
            disjoint = []
            for item in sorted(native_header_candidates, key=lambda value: value.box.x):
                if not disjoint or item.box.x >= disjoint[-1].box.right - EMU_PER_POINT:
                    disjoint.append(item)
            widths = [item.box.width for item in disjoint]
            functional_scorecard = (
                len(disjoint) >= 3
                and all(
                    abs(item.box.y - disjoint[0].box.y) <= 2 * EMU_PER_POINT for item in disjoint
                )
                and min(widths) > 0
                and max(widths) / min(widths) <= 1.25
            )
            if not functional_scorecard:
                zones["header"].add(slide_number)
        if slide_number != 1 and monochrome_count >= 3:
            findings.append(
                {
                    "kind": "unapproved_decorative_icon_cluster",
                    "slide": slide_number,
                    "icon_count": monochrome_count,
                }
            )
    for zone, slides in zones.items():
        if len(slides) >= 3:
            findings.append(
                {
                    "kind": "repeated_unapproved_decorative_icons",
                    "zone": zone,
                    "slides": sorted(slides),
                    "slide_count": len(slides),
                }
            )
    if pending_native_cover is not None and len(zones["header"]) >= 3:
        findings.append(
            {
                "kind": "unapproved_decorative_cover_icon",
                "slide": 1,
                "object_id": pending_native_cover,
            }
        )
    if len(explicitly_named_native_icon_slides) >= 3:
        findings.append(
            {
                "kind": "repeated_unapproved_decorative_icons",
                "zone": "explicitly_named_native_icons",
                "slides": sorted(explicitly_named_native_icon_slides),
                "slide_count": len(explicitly_named_native_icon_slides),
            }
        )
        if explicitly_named_native_cover_icon is not None and not any(
            entry["kind"] == "unapproved_decorative_cover_icon" for entry in findings
        ):
            findings.append(
                {
                    "kind": "unapproved_decorative_cover_icon",
                    "slide": 1,
                    "object_id": explicitly_named_native_cover_icon,
                }
            )
    return findings


def _approved_logo_findings(
    package: zipfile.ZipFile,
    parts: list[str],
    slide_width: float,
    slide_height: float,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    """Measure only logo assets independently authenticated by the caller."""

    hashes = {value.lower() for value in policy.get("approved_logo_sha256", [])}
    if any(re.fullmatch(r"[0-9a-f]{64}", value) is None for value in hashes):
        raise ValueError("approved logo hashes must be exact SHA-256 values")
    maximum = policy.get("max_logo_area")
    require_bottom_left = bool(policy.get("require_logo_bottom_left"))
    if (maximum is not None or require_bottom_left) and not hashes:
        raise ValueError("logo geometry rules require an independently approved logo hash")
    if maximum is not None and not 0 < maximum <= 1:
        raise ValueError("maximum logo area must be greater than zero and at most one")
    if not hashes:
        return []
    exceptions = set(policy.get("approved_logo_placement_slides", []))
    if any(number < 1 for number in exceptions):
        raise ValueError("approved logo placement slide numbers must be positive")
    findings = []
    for number, part in enumerate(parts, start=1):
        root = ET.fromstring(package.read(part))
        targets = _slide_relationship_targets(package, part)
        for item in _slide_objects(root):
            if item.kind != "pic":
                continue
            blip = item.element.find("p:blipFill/a:blip", NS)
            target = targets.get(blip.get(f"{{{NS['r']}}}embed", "")) if blip is not None else None
            if not target:
                continue
            media_part = (
                posixpath.normpath(target.lstrip("/"))
                if target.startswith("/")
                else posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
            )
            if not media_part.startswith("ppt/media/"):
                continue
            try:
                digest = hashlib.sha256(package.read(media_part)).hexdigest()
            except KeyError:
                continue
            if digest not in hashes:
                continue
            area = item.box.width * item.box.height / (slide_width * slide_height)
            if maximum is not None and area > maximum:
                findings.append(
                    {
                        "kind": "approved_logo_area_exceeded",
                        "slide": number,
                        "object_id": item.object_id,
                        "actual_area_ratio": round(area, 5),
                        "maximum_area_ratio": maximum,
                    }
                )
            if (
                require_bottom_left
                and number not in exceptions
                and not (
                    item.box.x / slide_width <= 0.25
                    and item.box.right / slide_width <= 0.40
                    and item.box.y / slide_height >= 0.65
                    and item.box.bottom / slide_height <= 0.97
                )
            ):
                findings.append(
                    {
                        "kind": "approved_logo_not_bottom_left",
                        "slide": number,
                        "object_id": item.object_id,
                    }
                )
    return findings


def _content_prose_findings(
    slide_number: int, objects: list[SlideObject], max_words: int
) -> list[dict[str, Any]]:
    """Count editable explanatory shapes, excluding native table/chart values."""

    if slide_number == 1:
        return []
    word_count = sum(
        len(
            re.findall(
                r"\b[\w’'-]+\b",
                " ".join(node.text or "" for node in item.element.findall(".//a:t", NS)),
            )
        )
        for item in objects
        if item.kind == "sp" and item.has_text
    )
    if word_count <= max_words:
        return []
    return [
        {
            "kind": "content_prose_density_exceeded",
            "slide": slide_number,
            "word_count": word_count,
            "word_limit": max_words,
        }
    ]


def _native_bullet_findings(
    slide_number: int,
    objects: list[SlideObject],
    slide_width: float,
    *,
    validate_geometry: bool,
    require_editorial: bool,
) -> list[dict[str, Any]]:
    """Inspect real bullet geometry and explicitly designated editorial roles."""

    findings: list[dict[str, Any]] = []
    primary_bullets: list[SlideObject] = []
    for item in objects:
        if item.kind != "sp" or not item.has_text:
            continue
        for paragraph_index, paragraph in enumerate(
            item.element.findall("p:txBody/a:p", NS), start=1
        ):
            properties = paragraph.find("a:pPr", NS)
            if properties is None or not (
                properties.find("a:buChar", NS) is not None
                or properties.find("a:buAutoNum", NS) is not None
            ):
                continue
            if require_editorial and item.box.width >= slide_width * 0.50:
                primary_bullets.append(item)
            if not validate_geometry:
                continue
            malformed = {}
            for attribute in ("marL", "indent"):
                raw = properties.get(attribute)
                if raw is None:
                    continue
                try:
                    value = int(raw)
                except ValueError:
                    continue
                if 0 < abs(value) < 1000:
                    malformed[attribute] = value
            if malformed:
                findings.append(
                    {
                        "kind": "malformed_native_bullet_geometry",
                        "slide": slide_number,
                        "object_id": item.object_id,
                        "paragraph_index": paragraph_index,
                        "actual_emu": malformed,
                        "emu_per_point": EMU_PER_POINT,
                    }
                )

    if not require_editorial or len(primary_bullets) < 4:
        return findings

    tolerance = slide_width * 0.035
    groups: list[list[SlideObject]] = []
    for item in sorted(primary_bullets, key=lambda value: value.box.x):
        for group in groups:
            if abs(item.box.x - group[0].box.x) <= tolerance:
                group.append(item)
                break
        else:
            groups.append([item])
    dominant = max(groups, key=len, default=[])
    if len(dominant) >= 4:
        findings.append(
            {
                "kind": "primary_bullet_wall_on_editorial_slide",
                "slide": slide_number,
                "native_bullet_count": len(dominant),
                "distinct_text_shape_count": len({item.object_id for item in dominant}),
                "maximum_region_width_ratio": round(
                    max(item.box.width for item in dominant) / slide_width, 4
                ),
            }
        )
    return findings


def inspect_presentation(
    path: str | Path, *, policy: dict[str, Any] | None = None
) -> dict[str, Any]:
    with zipfile.ZipFile(path) as package:
        presentation = ET.fromstring(package.read("ppt/presentation.xml"))
        size = presentation.find("p:sldSz", NS)
        if size is None:
            raise ValueError("presentation has no slide dimensions")
        width, height = float(size.get("cx", "0")), float(size.get("cy", "0"))
        parts = _slide_parts(package, presentation)
        findings = (
            _presentation_policy_findings(package, presentation, parts, policy) if policy else []
        )
        font_policy_report = None
        if policy and (
            policy.get("required_default_font_family") or policy.get("approved_font_families")
        ):
            font_findings, font_policy_report = inspect_presentation_font_policy(
                package, parts, policy
            )
            findings.extend(font_findings)
        if (
            policy
            and policy.get("require_uniform_font_family")
            and not policy.get("required_default_font_family")
            and not policy.get("approved_font_families")
        ):
            findings.extend(_uniform_presentation_font_findings(package, parts))
        if policy and policy.get("forbid_unapproved_decorative_icons"):
            findings.extend(_decorative_icon_findings(package, parts, width, height, policy))
        if policy and (
            policy.get("approved_logo_sha256")
            or policy.get("max_logo_area") is not None
            or policy.get("require_logo_bottom_left")
        ):
            findings.extend(_approved_logo_findings(package, parts, width, height, policy))
        for number, part in enumerate(parts, start=1):
            root = ET.fromstring(package.read(part))
            objects = _slide_objects(root)
            findings.extend(_connector_findings(number, objects))
            findings.extend(_text_overlap_findings(number, objects))
            findings.extend(_repeated_wrapped_body_heading_overlap_findings(number, objects))
            findings.extend(_text_overflow_findings(number, objects))
            findings.extend(_dense_bold_paragraph_findings(number, objects))
            if policy:
                approved_heading_slides = policy.get("approved_heading_slides", [])
                if policy.get("validate_heading_fit"):
                    findings.extend(_heading_fit_findings(number, objects, width, height))
                if (
                    policy.get("validate_heading_punctuation")
                    and number not in approved_heading_slides
                ):
                    findings.extend(_heading_punctuation_findings(number, objects, width, height))
                approved_bullet_slides = policy.get("approved_bullet_slides", [])
                validate_bullet_geometry = bool(policy.get("validate_bullet_geometry"))
                require_editorial = (
                    number in policy.get("require_editorial_slides", [])
                    and number not in approved_bullet_slides
                )
                if validate_bullet_geometry or require_editorial:
                    findings.extend(
                        _native_bullet_findings(
                            number,
                            objects,
                            width,
                            validate_geometry=validate_bullet_geometry,
                            require_editorial=require_editorial,
                        )
                    )
                allowed_redundant = policy.get("max_redundant_table_charts")
                exemptions = policy.get("approved_redundant_chart_slides", [])
                if allowed_redundant is not None and number not in exemptions:
                    findings.extend(
                        _redundant_chart_findings(package, part, root, number, allowed_redundant)
                    )
                if policy.get("folio_mode") == "actual_unpadded":
                    findings.extend(_folio_findings(number, objects, height))
                max_words = policy.get("max_content_prose_words")
                approved_dense = policy.get("approved_dense_slides", [])
                if max_words is not None and number not in approved_dense:
                    findings.extend(_content_prose_findings(number, objects, max_words))
            findings.extend(_slide_boundary_findings(number, objects, width, height))
            findings.extend(_table_findings(number, objects, height))

    # Estimated text metrics and inferred object roles cannot establish a broken
    # layout. Background bleed, deliberate layering, and grouped objects need
    # rendered review. Only independently declared, measurable requirements block.
    def diagnostic(finding: dict[str, Any]) -> bool:
        return finding["kind"] in STYLE_REVIEW_KINDS or (
            finding["kind"] == "cover_prose_density_exceeded"
            and (policy or {}).get("cover_word_limit") is None
        )

    warnings = [finding for finding in findings if diagnostic(finding)]
    findings = [finding for finding in findings if not diagnostic(finding)]
    return {
        "slide_count": len(parts),
        "slide_size_in": [
            round(width / EMU_PER_INCH, 4),
            round(height / EMU_PER_INCH, 4),
        ],
        "finding_count": len(findings),
        "findings": findings,
        "warning_count": len(warnings),
        "warnings": warnings,
        **({"font_policy": font_policy_report} if font_policy_report is not None else {}),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect PPTX connector layering and native table fit."
    )
    parser.add_argument("pptx", type=Path, help="PowerPoint file to inspect")
    parser.add_argument(
        "--inspect-font-families",
        action="store_true",
        help="Inspect only used text font families in a PPTX or PDF reference",
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit nonzero when one or more layout defects are detected",
    )
    parser.add_argument("--expected-aspect", help="Explicit task aspect ratio as N:D")
    parser.add_argument(
        "--expected-slide-size-emu",
        help="Approved template's exact physical slide dimensions as CX,CY",
    )
    parser.add_argument("--expected-slide-count", type=int)
    parser.add_argument("--require-native-table-slide", action="append", type=int, default=[])
    parser.add_argument("--require-editorial-slide", action="append", type=int, default=[])
    parser.add_argument("--require-uniform-font-family", action="store_true")
    parser.add_argument("--required-default-font-family")
    parser.add_argument("--approved-font-family", action="append", default=[])
    parser.add_argument("--approved-script-font", action="append", default=[])
    parser.add_argument("--validate-bullet-geometry", action="store_true")
    parser.add_argument("--validate-heading-fit", action="store_true")
    parser.add_argument("--validate-heading-punctuation", action="store_true")
    parser.add_argument("--approved-heading-slide", action="append", type=int, default=[])
    parser.add_argument("--approved-bullet-slide", action="append", type=int, default=[])
    parser.add_argument(
        "--cover-role", choices=("none", "cover", "explicit_hybrid"), default="none"
    )
    parser.add_argument("--cover-word-limit", type=int)
    parser.add_argument("--allow-cover-chart", action="store_true")
    parser.add_argument("--allow-cover-table", action="store_true")
    parser.add_argument("--max-redundant-table-charts", type=int)
    parser.add_argument("--approved-redundant-chart-slide", action="append", type=int, default=[])
    parser.add_argument("--max-content-prose-words", type=int)
    parser.add_argument("--approved-dense-slide", action="append", type=int, default=[])
    parser.add_argument("--forbid-unapproved-decorative-icons", action="store_true")
    parser.add_argument("--approved-image-sha256", action="append", default=[])
    parser.add_argument("--approved-icon-slide", action="append", type=int, default=[])
    parser.add_argument("--approved-logo-sha256", action="append", default=[])
    parser.add_argument("--max-logo-area", type=float)
    parser.add_argument("--require-logo-bottom-left", action="store_true")
    parser.add_argument("--approved-logo-placement-slide", action="append", type=int, default=[])
    parser.add_argument("--folio-mode", choices=("none", "actual_unpadded"), default="none")
    arguments = parser.parse_args(argv)
    if arguments.inspect_font_families:
        try:
            print(json.dumps(inspect_reference_font_families(arguments.pptx), sort_keys=True))
        except Exception as exc:
            print(
                json.dumps(
                    {"error": "reference_font_inspection_failed", "error_type": type(exc).__name__}
                ),
                file=sys.stderr,
            )
            return 2
        return 0
    policy = {
        "expected_aspect": arguments.expected_aspect,
        "expected_slide_size_emu": arguments.expected_slide_size_emu,
        "expected_slide_count": arguments.expected_slide_count,
        "require_native_table_slides": arguments.require_native_table_slide,
        "require_editorial_slides": arguments.require_editorial_slide,
        "require_uniform_font_family": arguments.require_uniform_font_family,
        "required_default_font_family": arguments.required_default_font_family,
        "approved_font_families": arguments.approved_font_family,
        "approved_script_fonts": arguments.approved_script_font,
        "validate_bullet_geometry": arguments.validate_bullet_geometry,
        "validate_heading_fit": arguments.validate_heading_fit,
        "validate_heading_punctuation": arguments.validate_heading_punctuation,
        "approved_heading_slides": arguments.approved_heading_slide,
        "approved_bullet_slides": arguments.approved_bullet_slide,
        "cover_role": arguments.cover_role,
        "cover_word_limit": arguments.cover_word_limit,
        "allow_cover_chart": arguments.allow_cover_chart,
        "allow_cover_table": arguments.allow_cover_table,
        "max_redundant_table_charts": arguments.max_redundant_table_charts,
        "approved_redundant_chart_slides": arguments.approved_redundant_chart_slide,
        "max_content_prose_words": arguments.max_content_prose_words,
        "approved_dense_slides": arguments.approved_dense_slide,
        "forbid_unapproved_decorative_icons": arguments.forbid_unapproved_decorative_icons,
        "approved_image_sha256": arguments.approved_image_sha256,
        "approved_icon_slides": arguments.approved_icon_slide,
        "approved_logo_sha256": arguments.approved_logo_sha256,
        "max_logo_area": arguments.max_logo_area,
        "require_logo_bottom_left": arguments.require_logo_bottom_left,
        "approved_logo_placement_slides": arguments.approved_logo_placement_slide,
        "folio_mode": arguments.folio_mode,
    }
    enabled = any(value not in (None, False, "none", []) for value in policy.values())
    try:
        report = inspect_presentation(arguments.pptx, policy=policy if enabled else None)
    except (OSError, KeyError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return int(arguments.fail_on_findings and bool(report["findings"]))


if __name__ == "__main__":
    raise SystemExit(main())
