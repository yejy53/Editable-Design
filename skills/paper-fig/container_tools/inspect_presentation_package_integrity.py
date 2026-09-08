#!/usr/bin/env python3
"""Inspect PPTX structure without reading slide text, notes, formulas, or values.

This is a conservative structural diagnostic, not complete ECMA-376 schema
validation or proof that Microsoft PowerPoint opens a presentation successfully.
The XML parser deliberately installs no character-data handler. Notes and
embedded workbooks are never parsed.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from xml.parsers import expat

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
REL_SLIDE = R + "/slide"
REL_CHART = R + "/chart"
REL_NOTES = R + "/notesSlide"
REL_OFFICE = R + "/officeDocument"
MAX_PARTS = 10_000
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

# These sequences are narrowly selected, well-established Office XML particles.
DLBL_ORDER = {
    "idx": 0,
    "delete": 1,
    "layout": 2,
    "tx": 3,
    "numFmt": 4,
    "spPr": 5,
    "txPr": 6,
    "dLblPos": 7,
    "showLegendKey": 8,
    "showVal": 9,
    "showCatName": 10,
    "showSerName": 11,
    "showPercent": 12,
    "showBubbleSize": 13,
    "separator": 14,
    "extLst": 15,
}
RUN_FILL = {"noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"}
RUN_FONT = {"latin", "ea", "cs", "sym"}
DRAWABLE = {"sp", "pic", "cxnSp", "graphicFrame", "grpSp"}
REL_ATTRIBUTES = {"id", "embed", "link"}


@dataclass(frozen=True)
class Relationship:
    identifier: str
    relationship_type: str
    target: str
    external: bool


@dataclass(frozen=True)
class Element:
    uri: str
    local: str
    attributes: dict[tuple[str, str], str]
    namespaces: dict[str, str]
    children: list["Element"]

    def attribute(self, name: str, namespace: str = "") -> str | None:
        return self.attributes.get((namespace, name))


class PackageIntegrityError(ValueError):
    """The input is unsafe or cannot be inspected as a PPTX package."""


def _expanded(name: str) -> tuple[str, str]:
    return tuple(name.split(" ", 1)) if " " in name else ("", name)


def _parse_xml(payload: bytes, part: str) -> tuple[Element, list[dict[str, Any]]]:
    """Parse element/attribute events only; character data is never collected."""

    parser = expat.ParserCreate(namespace_separator=" ")
    parser.buffer_text = False
    parser.ordered_attributes = False
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    stack: list[Element] = []
    pending_namespaces: dict[str, str] = {}
    issues: list[dict[str, Any]] = []
    root: Element | None = None

    def forbidden(*_: object) -> None:
        raise PackageIntegrityError(f"DTD or entity declarations are forbidden in {part}")

    def namespace(prefix: str | None, uri: str | None) -> None:
        pending_namespaces[prefix or ""] = uri or ""

    def start(name: str, raw_attributes: dict[str, str]) -> None:
        nonlocal root
        inherited = (
            dict(stack[-1].namespaces) if stack else {"xml": "http://www.w3.org/XML/1998/namespace"}
        )
        inherited.update(pending_namespaces)
        pending_namespaces.clear()
        uri, local = _expanded(name)
        attributes = {_expanded(key): value for key, value in raw_attributes.items()}
        element = Element(uri, local, attributes, inherited, [])
        if stack:
            stack[-1].children.append(element)
        elif root is None:
            root = element
        else:
            raise PackageIntegrityError(f"multiple document roots in {part}")

        qname = element.attribute("type", XSI)
        if qname and ":" in qname and qname.split(":", 1)[0] not in inherited:
            issues.append(_finding("undefined_qname_prefix", part, prefix=qname.split(":", 1)[0]))
        for attribute in ("Ignorable", "ProcessContent", "PreserveElements", "PreserveAttributes"):
            prefixes = element.attribute(attribute, MC)
            if prefixes:
                for prefix in prefixes.split():
                    if prefix.split(":", 1)[0] not in inherited:
                        issues.append(
                            _finding("undefined_qname_prefix", part, prefix=prefix.split(":", 1)[0])
                        )
        stack.append(element)

    def end(_: str) -> None:
        stack.pop()

    parser.StartDoctypeDeclHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.ExternalEntityRefHandler = lambda *_: 0
    parser.StartNamespaceDeclHandler = namespace
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    # Intentionally do not install CharacterDataHandler or DefaultHandler.
    try:
        parser.Parse(payload, True)
    except expat.ExpatError as exc:
        raise PackageIntegrityError(f"invalid XML in {part}: {exc}") from exc
    if root is None:
        raise PackageIntegrityError(f"XML document has no root: {part}")
    return root, issues


def _finding(code: str, part: str, **attributes: object) -> dict[str, Any]:
    return {"code": code, "part": part, **attributes}


def _descendants(element: Element):
    for child in element.children:
        yield child
        yield from _descendants(child)


def _relationship_part(source: str) -> str:
    directory, filename = posixpath.split(source)
    return posixpath.join(directory, "_rels", filename + ".rels")


def _source_part(relationships: str) -> str:
    if relationships == "_rels/.rels":
        return ""
    directory, filename = posixpath.split(relationships)
    if not directory.endswith("/_rels") or not filename.endswith(".rels"):
        raise PackageIntegrityError(f"invalid relationships part path: {relationships}")
    return posixpath.join(directory[:-6], filename[:-5])


def _target(source: str, target: str) -> str:
    normalized = (
        posixpath.normpath(target.lstrip("/"))
        if target.startswith("/")
        else posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
    )
    if normalized in {"", ".", ".."} or normalized.startswith("../"):
        raise PackageIntegrityError(f"relationship target escapes package: {source}")
    return normalized


def _content_types(root: Element) -> tuple[dict[str, str], dict[str, str]]:
    if (root.uri, root.local) != (CT, "Types"):
        raise PackageIntegrityError("[Content_Types].xml has an invalid root")
    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    for item in root.children:
        if item.uri != CT or item.local not in {"Default", "Override"}:
            continue
        content_type = item.attribute("ContentType")
        key = item.attribute("Extension" if item.local == "Default" else "PartName")
        if not key or not content_type:
            raise PackageIntegrityError("content-types entry is incomplete")
        if item.local == "Default":
            if key.casefold() in defaults:
                raise PackageIntegrityError("duplicate content-type default")
            defaults[key.casefold()] = content_type
        else:
            normalized = key.lstrip("/")
            if normalized in overrides:
                raise PackageIntegrityError("duplicate content-type override")
            overrides[normalized] = content_type
    return defaults, overrides


def _content_types_namespace_findings(payload: bytes) -> list[dict[str, Any]]:
    """Reject prefixed OPC manifest tags that the first-party .NET reader rejects."""

    parser = expat.ParserCreate()
    parser.buffer_text = False
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    depth = 0
    child_reported = False
    issues: list[dict[str, Any]] = []

    def start(name: str, attributes: dict[str, str]) -> None:
        nonlocal depth, child_reported
        if depth == 0 and (name != "Types" or attributes.get("xmlns") != CT):
            issues.append(
                _finding("content_types_default_namespace_required", "[Content_Types].xml")
            )
        elif depth == 1 and name not in {"Default", "Override"} and not child_reported:
            issues.append(
                _finding("content_types_unqualified_child_required", "[Content_Types].xml")
            )
            child_reported = True
        depth += 1

    def end(_: str) -> None:
        nonlocal depth
        depth -= 1

    def forbidden(*_: object) -> None:
        raise PackageIntegrityError(
            "DTD or entity declarations are forbidden in [Content_Types].xml"
        )

    parser.StartDoctypeDeclHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.ExternalEntityRefHandler = lambda *_: 0
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        parser.Parse(payload, True)
    except expat.ExpatError as exc:
        raise PackageIntegrityError(f"invalid XML in [Content_Types].xml: {exc}") from exc
    return issues


def _has_content_type(part: str, defaults: dict[str, str], overrides: dict[str, str]) -> bool:
    if part in overrides:
        return True
    suffix = "rels" if part.endswith(".rels") else PurePosixPath(part).suffix.lstrip(".").casefold()
    return bool(suffix and suffix in defaults)


def _relationships(root: Element, part: str) -> dict[str, Relationship]:
    if (root.uri, root.local) != (PR, "Relationships"):
        raise PackageIntegrityError(f"invalid relationships root in {part}")
    result = {}
    for item in root.children:
        if (item.uri, item.local) != (PR, "Relationship"):
            continue
        identifier = item.attribute("Id")
        kind = item.attribute("Type")
        target = item.attribute("Target")
        if not identifier or not kind or not target:
            raise PackageIntegrityError(f"incomplete relationship in {part}")
        if identifier in result:
            raise PackageIntegrityError(f"duplicate relationship id {identifier} in {part}")
        result[identifier] = Relationship(
            identifier, kind, target, item.attribute("TargetMode") == "External"
        )
    return result


def _choice_findings(root: Element, part: str) -> list[dict[str, Any]]:
    findings = []
    for item in _descendants(root):
        if item.uri == C and item.local in {"strCache", "strLit"}:
            for child in item.children:
                if (child.uri, child.local) == (C, "formatCode"):
                    findings.append(
                        _finding(
                            "string_cache_format_code_forbidden",
                            part,
                            element=item.local,
                        )
                    )
        if item.uri != C or item.local not in {"cat", "val", "xVal", "yVal", "bubbleSize", "tx"}:
            continue
        children = [child.local for child in item.children if child.uri == C]
        for alternatives in ({"numRef", "numLit"}, {"strRef", "strLit"}):
            present = [name for name in children if name in alternatives]
            if len(present) > 1:
                findings.append(
                    _finding(
                        "chart_source_exclusive_choice",
                        part,
                        element=item.local,
                        alternatives=present,
                    )
                )
    return findings


def _order_findings(root: Element, part: str) -> list[dict[str, Any]]:
    findings = []
    for item in _descendants(root):
        if item.uri == C and item.local == "dLbl":
            children = [
                child.local
                for child in item.children
                if child.uri == C and child.local in DLBL_ORDER
            ]
            positions = [DLBL_ORDER[name] for name in children]
            if positions != sorted(positions):
                findings.append(_finding("chart_dlbl_child_order", part, children=children))
        if item.uri == A and item.local in {"rPr", "defRPr", "endParaRPr"}:
            font_seen = False
            for child in item.children:
                if child.uri != A:
                    continue
                if child.local in RUN_FONT:
                    font_seen = True
                elif font_seen and child.local in RUN_FILL:
                    findings.append(
                        _finding("drawing_run_properties_child_order", part, element=item.local)
                    )
                    break
    return findings


def _children(element: Element, uri: str, local: str) -> list[Element]:
    return [child for child in element.children if (child.uri, child.local) == (uri, local)]


def _label_show_value(labels: Element | None) -> bool | None:
    if labels is None:
        return None
    values = _children(labels, C, "showVal")
    if not values:
        return None
    return values[-1].attribute("val") not in {"0", "false"}


def _invisible_series(element: Element) -> tuple[bool, bool]:
    properties = _children(element, C, "spPr")
    if not properties:
        return False, False
    style = properties[0]
    hidden = bool(_children(style, A, "noFill"))
    lines = _children(style, A, "ln")
    visible_outline = bool(
        lines
        and not _children(lines[0], A, "noFill")
        and (
            _children(lines[0], A, "solidFill")
            or _children(lines[0], A, "gradFill")
            or lines[0].attribute("w") not in {None, "", "0"}
        )
    )
    return hidden, visible_outline


def _element_index(element: Element) -> str | None:
    indices = _children(element, C, "idx")
    return indices[0].attribute("val") if indices else None


def _effective_point_labels(
    labels: Element | None,
    inherited: bool | None,
) -> dict[str | None, bool | None]:
    if labels is None:
        return {}
    result: dict[str | None, bool | None] = {}
    for point in _children(labels, C, "dLbl"):
        explicit = _label_show_value(point)
        result[_element_index(point)] = explicit if explicit is not None else inherited
    return result


def _stacked_chart_findings(root: Element, part: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for chart in _descendants(root):
        if (chart.uri, chart.local) != (C, "barChart"):
            continue
        groupings = _children(chart, C, "grouping")
        grouping = groupings[0].attribute("val") if groupings else None
        if grouping not in {"stacked", "percentStacked"}:
            continue

        for position in _descendants(chart):
            if (position.uri, position.local) == (C, "dLblPos") and position.attribute(
                "val"
            ) == "outEnd":
                findings.append(
                    _finding(
                        "stacked_chart_outside_end_label_forbidden",
                        part,
                        grouping=grouping,
                    )
                )

        chart_labels = _children(chart, C, "dLbls")
        inherited_show_value = _label_show_value(chart_labels[0] if chart_labels else None)
        inherited_point_labels = _effective_point_labels(
            chart_labels[0] if chart_labels else None,
            inherited_show_value,
        )
        for index, series in enumerate(_children(chart, C, "ser")):
            hidden, visible_outline = _invisible_series(series)
            series_labels = _children(series, C, "dLbls")
            explicit_show_value = _label_show_value(series_labels[0] if series_labels else None)
            effective_show_value = (
                explicit_show_value if explicit_show_value is not None else inherited_show_value
            )
            effective_points = {
                **inherited_point_labels,
                **_effective_point_labels(
                    series_labels[0] if series_labels else None,
                    effective_show_value,
                ),
            }
            if hidden and visible_outline:
                findings.append(
                    _finding(
                        "stacked_chart_hidden_offset_visible_outline",
                        part,
                        grouping=grouping,
                        series_index=index,
                    )
                )
            if hidden and (effective_show_value or any(effective_points.values())):
                findings.append(
                    _finding(
                        "stacked_chart_hidden_offset_value_label",
                        part,
                        grouping=grouping,
                        series_index=index,
                    )
                )
            for point in _children(series, C, "dPt"):
                point_hidden, point_outline = _invisible_series(point)
                point_index = _element_index(point)
                if not hidden and not point_hidden:
                    continue
                if point_outline:
                    findings.append(
                        _finding(
                            "stacked_chart_hidden_offset_visible_outline",
                            part,
                            grouping=grouping,
                            series_index=index,
                            point_index=point_index,
                        )
                    )
                if effective_points.get(point_index, effective_show_value) and not hidden:
                    findings.append(
                        _finding(
                            "stacked_chart_hidden_offset_value_label",
                            part,
                            grouping=grouping,
                            series_index=index,
                            point_index=point_index,
                        )
                    )
    return findings


def inspect_presentation_package(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    if not source.is_file() or source.is_symlink():
        raise PackageIntegrityError("presentation must be a regular local file")
    findings: list[dict[str, Any]] = []
    with zipfile.ZipFile(source) as package:
        members = [item for item in package.infolist() if not item.is_dir()]
        if len(members) > MAX_PARTS:
            raise PackageIntegrityError("presentation contains too many package parts")
        if sum(item.file_size for item in members) > MAX_UNCOMPRESSED_BYTES:
            raise PackageIntegrityError("presentation exceeds the safe uncompressed-size limit")
        names = [item.filename for item in members]
        if len(names) != len(set(names)):
            raise PackageIntegrityError("presentation contains duplicate package parts")
        for name in names:
            pure = PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts:
                raise PackageIntegrityError("presentation contains an unsafe package part path")
        corrupt = package.testzip()
        if corrupt:
            raise PackageIntegrityError(f"presentation contains a corrupt package part: {corrupt}")
        name_set = set(names)
        required = {
            "[Content_Types].xml",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
        }
        missing = sorted(required - name_set)
        if missing:
            raise PackageIntegrityError(
                "presentation is missing required package part: " + missing[0]
            )

        parsed: dict[str, Element] = {}
        notes_parts: set[str] = set()
        for name in names:
            if not name.endswith(".rels"):
                continue
            root, issues = _parse_xml(package.read(name), name)
            findings.extend(issues)
            parsed[name] = root
            owner = _source_part(name)
            if owner and owner not in name_set:
                findings.append(_finding("relationship_owner_missing", name))
            for relationship in _relationships(root, name).values():
                if relationship.external:
                    continue
                target = _target(owner, relationship.target)
                if target not in name_set:
                    findings.append(
                        _finding(
                            "relationship_target_missing",
                            name,
                            relationship_id=relationship.identifier,
                        )
                    )
                if relationship.relationship_type == REL_NOTES:
                    notes_parts.add(target)

        types_payload = package.read("[Content_Types].xml")
        types_root, issues = _parse_xml(types_payload, "[Content_Types].xml")
        findings.extend(issues)
        findings.extend(_content_types_namespace_findings(types_payload))
        defaults, overrides = _content_types(types_root)
        for name in names:
            if name == "[Content_Types].xml":
                continue
            if not _has_content_type(name, defaults, overrides):
                findings.append(_finding("content_type_missing", name))
        for name in overrides:
            if name not in name_set:
                findings.append(_finding("content_type_target_missing", name))

        presentation, issues = _parse_xml(
            package.read("ppt/presentation.xml"), "ppt/presentation.xml"
        )
        findings.extend(issues)
        if (presentation.uri, presentation.local) != (P, "presentation"):
            raise PackageIntegrityError("presentation.xml has an invalid root")
        presentation_relationships = _relationships(
            parsed["ppt/_rels/presentation.xml.rels"], "ppt/_rels/presentation.xml.rels"
        )
        slide_ids: set[str] = set()
        slide_parts: list[str] = []
        for listing in (
            item for item in presentation.children if (item.uri, item.local) == (P, "sldIdLst")
        ):
            for item in listing.children:
                if (item.uri, item.local) != (P, "sldId"):
                    continue
                slide_id = item.attribute("id")
                relationship_id = item.attribute("id", R)
                if not slide_id or slide_id in slide_ids:
                    findings.append(
                        _finding("slide_id_invalid_or_duplicate", "ppt/presentation.xml")
                    )
                    continue
                slide_ids.add(slide_id)
                relationship = presentation_relationships.get(relationship_id or "")
                if (
                    relationship is None
                    or relationship.relationship_type != REL_SLIDE
                    or relationship.external
                ):
                    findings.append(
                        _finding(
                            "slide_relationship_missing_or_invalid",
                            "ppt/presentation.xml",
                            relationship_id=relationship_id or "",
                        )
                    )
                    continue
                part = _target("ppt/presentation.xml", relationship.target)
                if part in slide_parts:
                    findings.append(_finding("slide_part_duplicate", part))
                elif part in name_set:
                    slide_parts.append(part)
        if not slide_parts:
            findings.append(_finding("presentation_has_no_resolved_slides", "ppt/presentation.xml"))

        chart_parts: set[str] = set()
        for part in slide_parts:
            root, issues = _parse_xml(package.read(part), part)
            findings.extend(issues)
            if (root.uri, root.local) != (P, "sld"):
                findings.append(_finding("slide_root_invalid", part))
                continue
            trees = [item for item in _descendants(root) if (item.uri, item.local) == (P, "spTree")]
            if not trees or not any(
                child.uri == P and child.local in DRAWABLE
                for tree in trees
                for child in tree.children
            ):
                findings.append(_finding("slide_has_no_drawable_objects", part))
            relationship_part = _relationship_part(part)
            relationships = (
                _relationships(parsed[relationship_part], relationship_part)
                if relationship_part in parsed
                else {}
            )
            for item in _descendants(root):
                for (namespace, attribute), relationship_id in item.attributes.items():
                    if namespace != R or attribute not in REL_ATTRIBUTES:
                        continue
                    relationship = relationships.get(relationship_id)
                    if relationship is None:
                        findings.append(
                            _finding(
                                "referenced_relationship_missing",
                                part,
                                relationship_id=relationship_id,
                            )
                        )
                        continue
                    if (item.uri, item.local) == (C, "chart"):
                        if relationship.relationship_type != REL_CHART or relationship.external:
                            findings.append(
                                _finding(
                                    "chart_relationship_invalid",
                                    part,
                                    relationship_id=relationship_id,
                                )
                            )
                        else:
                            chart_parts.add(_target(part, relationship.target))
            findings.extend(_order_findings(root, part))

        for part in sorted(chart_parts):
            if part not in name_set:
                findings.append(_finding("chart_part_missing", part))
                continue
            root, issues = _parse_xml(package.read(part), part)
            findings.extend(issues)
            if (root.uri, root.local) != (C, "chartSpace"):
                findings.append(_finding("chart_root_invalid", part))
            relationship_part = _relationship_part(part)
            relationships = (
                _relationships(parsed[relationship_part], relationship_part)
                if relationship_part in parsed
                else {}
            )
            for item in _descendants(root):
                for (namespace, attribute), relationship_id in item.attributes.items():
                    if (
                        namespace == R
                        and attribute in REL_ATTRIBUTES
                        and relationship_id not in relationships
                    ):
                        findings.append(
                            _finding(
                                "referenced_relationship_missing",
                                part,
                                relationship_id=relationship_id,
                            )
                        )
            findings.extend(_choice_findings(root, part))
            findings.extend(_order_findings(root, part))
            findings.extend(_stacked_chart_findings(root, part))

    return {
        "status": "fail" if findings else "pass",
        "slide_count": len(slide_parts),
        "chart_count": len(chart_parts),
        "relationship_part_count": len(parsed),
        "notes_parts_skipped": len(notes_parts),
        "finding_count": len(findings),
        "findings": findings,
        "claim_boundary": "Structural package checks only; no slide text, notes, formulas, chart values, or native PowerPoint execution were inspected.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect PPTX structure without reading presentation content."
    )
    parser.add_argument("pptx", type=Path)
    parser.add_argument("--fail-on-findings", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        report = inspect_presentation_package(arguments.pptx)
    except (OSError, zipfile.BadZipFile, PackageIntegrityError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return int(arguments.fail_on_findings and bool(report["findings"]))


if __name__ == "__main__":
    raise SystemExit(main())
