#!/usr/bin/env python3
"""Validate only explicitly requested, source-approved presentation template rules.

No prompt wording, slide text, source-image bytes, or universal coverage
threshold is returned. Supplying no explicit requirement is a neutral no-op.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import posixpath
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit
from xml.etree import ElementTree

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"p": P, "a": A, "r": R, "pr": PR}
MAX_PART_BYTES = 100 * 1024 * 1024
MAX_PARTS = 2500
MAX_PACKAGE_BYTES = 512 * 1024 * 1024


class TemplateGateError(ValueError):
    """A caller configuration or approved package is unsafe or malformed."""


@dataclass(frozen=True)
class TemplateFidelityRequirements:
    reference_slide_indices: tuple[int, ...] = ()
    minimum_coverage_ratio: float | None = None
    require_exact_dimensions: bool = False
    require_placeholder_geometry: bool = False
    require_photographic_background: bool = False
    geometry_tolerance_emu: int = 0

    @property
    def enabled(self) -> bool:
        return bool(
            self.reference_slide_indices
            or self.minimum_coverage_ratio is not None
            or self.require_exact_dimensions
            or self.require_placeholder_geometry
            or self.require_photographic_background
        )


@dataclass(frozen=True)
class _SlideProfile:
    family: tuple[Any, ...]
    placeholders: tuple[tuple[str, str, tuple[int, int, int, int] | None], ...]
    photographic_background: bool


@dataclass(frozen=True)
class _Presentation:
    dimensions: tuple[int, int]
    slides: tuple[_SlideProfile, ...]


def _require(condition: bool, code: str) -> None:
    if not condition:
        raise TemplateGateError(code)


def _xml(package: zipfile.ZipFile, name: str) -> ElementTree.Element:
    try:
        info = package.getinfo(name)
    except KeyError as exc:
        raise TemplateGateError("missing_required_package_part") from exc
    _require(info.file_size <= MAX_PART_BYTES, "oversized_package_part")
    payload = package.read(info)
    _require(
        b"<!doctype" not in payload.lower() and b"<!entity" not in payload.lower(),
        "unsafe_package_xml",
    )
    try:
        return ElementTree.fromstring(payload)
    except ElementTree.ParseError as exc:
        raise TemplateGateError("malformed_package_xml") from exc


def _resolved(parent: str, target: str) -> str:
    _require(isinstance(target, str) and bool(target), "invalid_relationship_target")
    parsed = urlsplit(target)
    _require(
        not parsed.scheme and not parsed.netloc and "\\" not in target,
        "external_relationship_rejected",
    )
    if target.startswith("/"):
        result = posixpath.normpath(target.lstrip("/"))
    else:
        result = posixpath.normpath(posixpath.join(posixpath.dirname(parent), target))
    _require(result != ".." and not result.startswith("../"), "unsafe_relationship_target")
    return result


def _relationships(package: zipfile.ZipFile, part: str) -> dict[str, dict[str, str]]:
    rel_path = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
    if rel_path not in package.namelist():
        return {}
    result: dict[str, dict[str, str]] = {}
    identities: set[str] = set()
    for item in _xml(package, rel_path).findall("pr:Relationship", NS):
        identity = item.get("Id", "")
        target = item.get("Target", "")
        _require(bool(identity and target), "invalid_relationship")
        _require(identity not in identities, "duplicate_relationship_id")
        identities.add(identity)
        mode = item.get("TargetMode", "Internal").casefold()
        _require(mode in {"internal", "external"}, "invalid_relationship_mode")
        if mode == "external":
            # A normal clickable link is not an externally loaded resource.
            # Permit it only with the genuine hyperlink relationship type, never
            # image, workbook, OLE, or other package relationships.
            parsed = urlsplit(target)
            _require(
                item.get("Type") == R + "/hyperlink"
                and not any(ord(character) <= 32 or ord(character) == 127 for character in target)
                and "\\" not in target
                and (
                    parsed.scheme.casefold() in {"http", "https"}
                    and bool(parsed.hostname)
                    or parsed.scheme.casefold() == "mailto"
                    and bool(parsed.path)
                    and not parsed.netloc
                ),
                "external_relationship_rejected",
            )
            continue
        _resolved(part, target)
        result[identity] = {"target": target, "type": item.get("Type", "")}
    return result


def _relationship_of_type(
    relationships: Mapping[str, Mapping[str, str]], suffix: str
) -> str | None:
    values = [
        item["target"] for item in relationships.values() if item.get("type", "").endswith(suffix)
    ]
    _require(len(values) <= 1, "ambiguous_layout_relationship")
    return values[0] if values else None


def _geometry(shape: ElementTree.Element) -> tuple[int, int, int, int] | None:
    transform = shape.find("./p:spPr/a:xfrm", NS)
    if transform is None:
        return None
    offset = transform.find("a:off", NS)
    extent = transform.find("a:ext", NS)
    if offset is None or extent is None:
        return None
    try:
        return (
            int(offset.get("x", "0")),
            int(offset.get("y", "0")),
            int(extent.get("cx", "0")),
            int(extent.get("cy", "0")),
        )
    except ValueError as exc:
        raise TemplateGateError("invalid_placeholder_geometry") from exc


def _placeholder_map(
    root: ElementTree.Element,
) -> dict[tuple[str, str], tuple[int, int, int, int] | None]:
    result = {}
    for shape in root.findall(".//p:sp", NS):
        placeholder = shape.find("./p:nvSpPr/p:nvPr/p:ph", NS)
        if placeholder is None:
            continue
        key = (placeholder.get("type", "obj"), placeholder.get("idx", ""))
        _require(key not in result, "duplicate_placeholder_identity")
        result[key] = _geometry(shape)
    return result


def _fallback_geometry(
    key: tuple[str, str], *layers: Mapping[tuple[str, str], tuple[int, int, int, int] | None]
) -> tuple[int, int, int, int] | None:
    for layer in layers:
        if key in layer and layer[key] is not None:
            return layer[key]
        matches = [
            value for (kind, _), value in layer.items() if kind == key[0] and value is not None
        ]
        if len(matches) == 1:
            return matches[0]
    return None


def _photographic_background(
    package: zipfile.ZipFile, layers: tuple[tuple[str, ElementTree.Element], ...]
) -> bool:
    for part, node in layers:
        background = node.find("./p:cSld/p:bg", NS)
        if background is None:
            continue
        fill = background.find(".//a:blipFill", NS)
        if fill is None:
            # An explicit non-photo background replaces inherited backgrounds.
            return False
        blip = fill.find("a:blip", NS)
        _require(blip is not None, "invalid_photographic_background")
        _require(blip.get("{" + R + "}link") is None, "external_relationship_rejected")
        identity = blip.get("{" + R + "}embed", "")
        relationship = _relationships(package, part).get(identity)
        _require(
            relationship is not None and relationship.get("type", "").endswith("/image"),
            "missing_background_image_relationship",
        )
        image_part = _resolved(part, relationship["target"])
        _require(image_part in package.namelist(), "missing_background_image_part")
        _require(
            posixpath.splitext(image_part)[1].casefold()
            in {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"},
            "invalid_background_image_type",
        )
        return True
    return False


def _slide_profile(package: zipfile.ZipFile, part: str) -> _SlideProfile:
    slide = _xml(package, part)
    slide_rels = _relationships(package, part)
    layout_target = _relationship_of_type(slide_rels, "/slideLayout")
    layout_part = _resolved(part, layout_target) if layout_target else None
    layout = _xml(package, layout_part) if layout_part else None
    layout_rels = _relationships(package, layout_part) if layout_part else {}
    master_target = _relationship_of_type(layout_rels, "/slideMaster")
    master_part = _resolved(layout_part, master_target) if layout_part and master_target else None
    master = _xml(package, master_part) if master_part else None

    source_placeholders = _placeholder_map(slide)
    layout_placeholders = _placeholder_map(layout) if layout is not None else {}
    master_placeholders = _placeholder_map(master) if master is not None else {}
    identities = set(source_placeholders) | set(layout_placeholders)
    if not identities:
        identities = set(master_placeholders)
    resolved = tuple(
        sorted(
            (
                kind,
                index,
                _fallback_geometry(
                    (kind, index), source_placeholders, layout_placeholders, master_placeholders
                ),
            )
            for kind, index in identities
        )
    )
    layout_type = layout.get("type", "custom") if layout is not None else "unassigned"
    family = (
        layout_type,
        tuple(sorted((kind, index) for kind, index in identities)),
        tuple(sorted((kind, index) for kind, index in master_placeholders)),
    )
    layers: list[tuple[str, ElementTree.Element]] = [(part, slide)]
    if layout_part and layout is not None:
        layers.append((layout_part, layout))
    if master_part and master is not None:
        layers.append((master_part, master))
    return _SlideProfile(
        family=family,
        placeholders=resolved,
        photographic_background=_photographic_background(package, tuple(layers)),
    )


def _read_presentation(value: str | Path | bytes) -> _Presentation:
    handle: io.BytesIO | str | Path = io.BytesIO(value) if isinstance(value, bytes) else value
    try:
        with zipfile.ZipFile(handle) as package:
            _require(len(package.infolist()) <= MAX_PARTS, "excessive_package_parts")
            _require(
                len(package.namelist()) == len(set(package.namelist())), "duplicate_package_parts"
            )
            _require(
                sum(item.file_size for item in package.infolist()) <= MAX_PACKAGE_BYTES,
                "oversized_package",
            )
            for item in package.infolist():
                _require(
                    not item.filename.startswith("/")
                    and ".." not in item.filename.split("/")
                    and "\\" not in item.filename,
                    "unsafe_package_part",
                )
                if item.filename.endswith(".rels"):
                    directory, filename = posixpath.split(item.filename)
                    if item.filename == "_rels/.rels":
                        owner = ""
                    else:
                        _require(directory.endswith("/_rels"), "invalid_relationship_part")
                        owner = posixpath.join(directory[:-6], filename[:-5])
                    _relationships(package, owner)
            presentation = _xml(package, "ppt/presentation.xml")
            size = presentation.find("p:sldSz", NS)
            _require(size is not None, "missing_presentation_dimensions")
            try:
                dimensions = (int(size.get("cx", "")), int(size.get("cy", "")))
            except ValueError as exc:
                raise TemplateGateError("invalid_presentation_dimensions") from exc
            _require(all(x > 0 for x in dimensions), "invalid_presentation_dimensions")
            relationships = _relationships(package, "ppt/presentation.xml")
            slides = []
            for item in presentation.findall("./p:sldIdLst/p:sldId", NS):
                relationship = relationships.get(item.get("{" + R + "}id", ""))
                _require(
                    relationship is not None and relationship.get("type", "").endswith("/slide"),
                    "missing_slide_relationship",
                )
                slides.append(
                    _slide_profile(
                        package, _resolved("ppt/presentation.xml", relationship["target"])
                    )
                )
            return _Presentation(dimensions=dimensions, slides=tuple(slides))
    except zipfile.BadZipFile as exc:
        raise TemplateGateError("invalid_powerpoint_package") from exc


def _valid_requirements(value: TemplateFidelityRequirements) -> None:
    _require(isinstance(value, TemplateFidelityRequirements), "invalid_template_requirements")
    indices = value.reference_slide_indices
    _require(
        isinstance(indices, tuple)
        and all(isinstance(x, int) and not isinstance(x, bool) and x > 0 for x in indices),
        "invalid_reference_slide_indices",
    )
    _require(len(set(indices)) == len(indices), "duplicate_reference_slide_indices")
    if value.minimum_coverage_ratio is not None:
        ratio = value.minimum_coverage_ratio
        _require(
            isinstance(ratio, (int, float))
            and not isinstance(ratio, bool)
            and math.isfinite(float(ratio))
            and 0 <= float(ratio) <= 1,
            "invalid_explicit_minimum_ratio",
        )
        _require(bool(indices), "minimum_ratio_requires_explicit_reference_slides")
    if indices:
        _require(
            value.minimum_coverage_ratio is not None,
            "reference_slides_require_explicit_minimum_ratio",
        )
    if value.require_placeholder_geometry or value.require_photographic_background:
        _require(bool(indices), "explicit_requirement_needs_reference_slides")
    _require(
        isinstance(value.geometry_tolerance_emu, int)
        and not isinstance(value.geometry_tolerance_emu, bool)
        and value.geometry_tolerance_emu >= 0,
        "invalid_geometry_tolerance",
    )


def _geometry_equal(source: _SlideProfile, generated: _SlideProfile, tolerance: int) -> bool:
    a = {(kind, index): geometry for kind, index, geometry in source.placeholders}
    b = {(kind, index): geometry for kind, index, geometry in generated.placeholders}
    if set(a) != set(b):
        return False
    for key, left in a.items():
        right = b[key]
        if left is None or right is None:
            if left != right:
                return False
            continue
        if any(abs(x - y) > tolerance for x, y in zip(left, right)):
            return False
    return True


def validate_template_source_fidelity(
    source_template: str | Path | bytes,
    generated_presentation: str | Path | bytes,
    requirements: TemplateFidelityRequirements,
) -> dict[str, Any]:
    _valid_requirements(requirements)
    result: dict[str, Any] = {
        "schema_version": "template_source_fidelity.v1",
        "status": "not_applicable",
        "passed": True,
        "reference_family_count": 0,
        "matched_family_count": 0,
        "generated_slide_count": 0,
        "matched_generated_slide_count": 0,
        "coverage_ratio": None,
        "minimum_coverage_ratio": requirements.minimum_coverage_ratio,
        "dimensions_match": None,
        "geometry_match": None,
        "photographic_background_required": requirements.require_photographic_background,
        "photographic_background_matched": None,
        "issue_codes": [],
        "prompt_or_slide_text_included": False,
    }
    if not requirements.enabled:
        return result

    source = _read_presentation(source_template)
    generated = _read_presentation(generated_presentation)
    _require(bool(generated.slides), "generated_presentation_has_no_slides")
    result["generated_slide_count"] = len(generated.slides)
    issues: set[str] = set()
    if requirements.require_exact_dimensions:
        result["dimensions_match"] = source.dimensions == generated.dimensions
        if not result["dimensions_match"]:
            issues.add("template_dimensions_mismatch")

    references: dict[tuple[Any, ...], list[_SlideProfile]] = {}
    for index in requirements.reference_slide_indices:
        _require(index <= len(source.slides), "reference_slide_out_of_range")
        profile = source.slides[index - 1]
        profiles = references.setdefault(profile.family, [])
        if profile not in profiles:
            profiles.append(profile)
    result["reference_family_count"] = len(references)

    matched_families: set[tuple[Any, ...]] = set()
    matched_generated_slides = 0
    geometry_valid = True
    required_photo_families = {
        family
        for family, profiles in references.items()
        if any(profile.photographic_background for profile in profiles)
    }
    matched_photo_families: set[tuple[Any, ...]] = set()
    photo_mismatch = False
    for slide in generated.slides:
        profiles = references.get(slide.family)
        if not profiles:
            continue
        if requirements.require_placeholder_geometry:
            profiles = [
                profile
                for profile in profiles
                if _geometry_equal(profile, slide, requirements.geometry_tolerance_emu)
            ]
            if not profiles:
                geometry_valid = False
                continue
        if requirements.require_photographic_background:
            photographic_profiles = [
                profile for profile in profiles if profile.photographic_background
            ]
            if photographic_profiles and not slide.photographic_background:
                photo_mismatch = True
                continue
            if photographic_profiles and slide.photographic_background:
                matched_photo_families.add(slide.family)
        matched_generated_slides += 1
        matched_families.add(slide.family)

    result["matched_family_count"] = len(matched_families)
    result["matched_generated_slide_count"] = matched_generated_slides
    if references:
        result["coverage_ratio"] = matched_generated_slides / len(generated.slides)
        if float(result["coverage_ratio"]) < float(requirements.minimum_coverage_ratio):
            issues.add("explicit_template_family_coverage_not_met")
    if requirements.require_placeholder_geometry:
        result["geometry_match"] = geometry_valid
        if not geometry_valid:
            issues.add("template_placeholder_geometry_mismatch")
    if requirements.require_photographic_background:
        if not required_photo_families:
            issues.add("source_photographic_background_not_found")
        result["photographic_background_matched"] = (
            bool(required_photo_families)
            and matched_photo_families == required_photo_families
            and not photo_mismatch
        )
        if not result["photographic_background_matched"]:
            issues.add("template_photographic_background_missing")

    result["issue_codes"] = sorted(issues)
    result["passed"] = not issues
    result["status"] = "passed" if result["passed"] else "failed"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_template", type=Path)
    parser.add_argument("generated_presentation", type=Path)
    parser.add_argument("--reference-slide", action="append", default=[], type=int)
    parser.add_argument("--minimum-ratio", type=float)
    parser.add_argument("--require-exact-dimensions", action="store_true")
    parser.add_argument("--require-placeholder-geometry", action="store_true")
    parser.add_argument("--require-photographic-background", action="store_true")
    parser.add_argument("--geometry-tolerance-emu", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        requirements = TemplateFidelityRequirements(
            reference_slide_indices=tuple(args.reference_slide),
            minimum_coverage_ratio=args.minimum_ratio,
            require_exact_dimensions=args.require_exact_dimensions,
            require_placeholder_geometry=args.require_placeholder_geometry,
            require_photographic_background=args.require_photographic_background,
            geometry_tolerance_emu=args.geometry_tolerance_emu,
        )
        result = validate_template_source_fidelity(
            args.source_template, args.generated_presentation, requirements
        )
    except (TemplateGateError, OSError) as exc:
        code = str(exc) if isinstance(exc, TemplateGateError) else "approved_package_unavailable"
        print(
            json.dumps(
                {
                    "schema_version": "template_source_fidelity.v1",
                    "status": "error",
                    "passed": False,
                    "issue_codes": [code],
                },
                sort_keys=True,
            )
        )
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
