#!/usr/bin/env python3
"""Source-free, slide-specific validation of genuine native PowerPoint charts.

Only explicitly declared quantitative-chart slides are governed. Editable maps,
scientific diagrams, approved source figures, and unrelated slides never become
chart failures merely because they are not Excel-backed PowerPoint charts.
Portable mode retains the original durable embedded-workbook requirement;
explicit PowerPoint mode also accepts complete, editable native literal data.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent
MAX_PACKAGE_BYTES = 128 * 1024 * 1024
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_PACKAGE_PARTS = 10_000
MAX_EXPECTED_SLIDES = 500
MAX_CHARTS_PER_SLIDE = 25
CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
WORKBOOK_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CHART_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
WORKBOOK_RELATIONSHIP = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package"
)
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
SUPPORTED_CHART_TYPES = frozenset(
    {
        "areaChart",
        "area3DChart",
        "barChart",
        "bar3DChart",
        "bubbleChart",
        "doughnutChart",
        "lineChart",
        "line3DChart",
        "ofPieChart",
        "pieChart",
        "pie3DChart",
        "radarChart",
        "scatterChart",
        "stockChart",
        "surfaceChart",
        "surface3DChart",
    }
)
SAFE_POLICY = "user_approved_unrecoverable_source_figure"
_SLIDE = re.compile(r"ppt/slides/slide([1-9][0-9]*)\.xml\Z")
_DISCLOSURE = re.compile(r"\b(?:non[ -]?editable|not editable|uneditable)\b", re.IGNORECASE)


class ChartGateError(ValueError):
    """Bounded, content-free structural package validation error."""


@dataclass(frozen=True)
class SourceFigureException:
    """Explicit per-slide exception; never inferred from an image or source type."""

    user_approved: bool
    policy: str = SAFE_POLICY


def _require(value: bool, message: str) -> None:
    if not value:
        raise ChartGateError(message)


def _safe_xml(package: zipfile.ZipFile, name: str) -> ElementTree.Element:
    try:
        info = package.getinfo(name)
    except KeyError as exc:
        raise ChartGateError("Required package relationship or XML part is absent") from exc
    _require(
        0 < info.file_size <= MAX_PART_BYTES,
        "A required PowerPoint package part exceeds its bounded size",
    )
    material = package.read(info)
    _require(
        b"<!DOCTYPE" not in material.upper(),
        "PowerPoint package XML must not contain a document-type declaration",
    )
    try:
        return ElementTree.fromstring(material)
    except ElementTree.ParseError as exc:
        raise ChartGateError(
            "PowerPoint package contains malformed relationship or chart XML"
        ) from exc


def _resolved_part(parent: str, target: Any, *, root: str = "ppt") -> str:
    _require(
        isinstance(target, str) and bool(target),
        "A PowerPoint package relationship target is missing",
    )
    _require(
        "\\" not in target and ":" not in target and "?" not in target and "#" not in target,
        "A package relationship target must be an internal part path",
    )
    if target.startswith("/"):
        parts = target.lstrip("/").split("/")
    else:
        parts = parent.split("/")[:-1] + target.split("/")
    normalized: list[str] = []
    for part in parts:
        if part in {"", "."}:
            continue
        if part == "..":
            _require(bool(normalized), "A PowerPoint relationship escapes its package root")
            normalized.pop()
        else:
            normalized.append(part)
    _require(
        bool(normalized) and normalized[0] == root,
        "A PowerPoint relationship escapes its approved presentation package",
    )
    return "/".join(normalized)


def _relationships(package: zipfile.ZipFile, parent: str) -> dict[str, dict[str, str]]:
    relative = str(PurePosixPath(parent).parent / "_rels" / (PurePosixPath(parent).name + ".rels"))
    if relative not in package.namelist():
        return {}
    root = _safe_xml(package, relative)
    result = {}
    for item in root:
        identifier = item.get("Id")
        _require(
            isinstance(identifier, str) and bool(identifier) and identifier not in result,
            "A PowerPoint package contains duplicate or missing relationship identifiers",
        )
        mode = item.get("TargetMode")
        # Ordinary hyperlinks do not weaken an unrelated real native chart. Keep
        # them inert, but reject an external relationship if the chart selects it.
        result[identifier] = {
            "type": str(item.get("Type") or ""),
            "mode": "Internal" if mode is None or mode == "Internal" else "External",
            "target": _resolved_part(parent, item.get("Target"))
            if mode is None or mode == "Internal"
            else "",
        }
    return result


def _content_types(package: zipfile.ZipFile) -> dict[str, str]:
    root = _safe_xml(package, "[Content_Types].xml")
    result: dict[str, str] = {}
    defaults: dict[str, str] = {}
    for item in root:
        part = item.get("PartName")
        if part:
            result[part.lstrip("/")] = str(item.get("ContentType") or "")
        else:
            extension = item.get("Extension")
            if extension:
                key = extension.casefold()
                _require(key not in defaults, "A PowerPoint package repeats a default content type")
                defaults[key] = str(item.get("ContentType") or "")
    for part in package.namelist():
        if part not in result and "." in part.rsplit("/", 1)[-1]:
            extension = part.rsplit(".", 1)[-1].casefold()
            if extension in defaults:
                result[part] = defaults[extension]
    return result


def logical_presentation_slides(package: zipfile.ZipFile) -> dict[int, str]:
    """Resolve actual presentation order, never physical slide filenames."""
    root = _safe_xml(package, "ppt/presentation.xml")
    _require(
        root.tag == "{" + NS["p"] + "}presentation",
        "The presentation slide-order document is invalid",
    )
    lists = root.findall("p:sldIdLst", NS)
    _require(
        len(lists) == 1, "The presentation must declare exactly one authoritative slide-order list"
    )
    entries = lists[0].findall("p:sldId", NS)
    _require(
        0 < len(entries) <= MAX_EXPECTED_SLIDES,
        "The presentation slide-order list is empty or exceeds its bounded size",
    )
    relationships = _relationships(package, "ppt/presentation.xml")
    names = set(package.namelist())
    ordered: dict[int, str] = {}
    seen_ids: set[str] = set()
    seen_parts: set[str] = set()
    for ordinal, entry in enumerate(entries, 1):
        identifier = entry.get("{" + NS["r"] + "}id")
        _require(
            isinstance(identifier, str) and bool(identifier) and identifier not in seen_ids,
            "The presentation slide-order list contains a missing or repeated relationship",
        )
        seen_ids.add(identifier)
        relation = relationships.get(identifier)
        _require(
            relation is not None
            and relation.get("mode") == "Internal"
            and relation.get("type") == NS["r"] + "/slide",
            "The presentation slide-order relationship must be an internal genuine slide",
        )
        target = str(relation.get("target") or "")
        _require(
            target.startswith("ppt/slides/")
            and target.endswith(".xml")
            and "/_rels/" not in target
            and target in names
            and target not in seen_parts,
            "The presentation slide-order relationship is missing, unsafe, or duplicated",
        )
        slide = _safe_xml(package, target)
        _require(
            slide.tag == "{" + NS["p"] + "}sld",
            "The presentation slide-order relationship does not identify a genuine slide",
        )
        seen_parts.add(target)
        ordered[ordinal] = target
    return ordered


def _decimal(value: Any) -> Decimal:
    _require(
        isinstance(value, str) and len(value) <= 100,
        "A chart or embedded workbook contains an invalid numeric point",
    )
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ChartGateError(
            "A chart or embedded workbook contains an invalid numeric point"
        ) from exc
    _require(number.is_finite(), "A chart or embedded workbook contains a non-finite numeric point")
    return number.normalize()


@dataclass(frozen=True)
class WorkbookCell:
    kind: str
    value: str | Decimal


@dataclass(frozen=True)
class ChartWorkbook:
    sheets: Mapping[str, Mapping[str, WorkbookCell]]
    numeric_cell_count: int


def _string_value(element: ElementTree.Element) -> str:
    # Phonetic annotations are not part of the cell's displayed string.
    return "".join(
        item.text or "" for item in element.findall("x:t", NS) + element.findall("x:r/x:t", NS)
    )


def _workbook_cells(package: zipfile.ZipFile, path: str) -> ChartWorkbook:
    try:
        info = package.getinfo(path)
    except KeyError as exc:
        raise ChartGateError("A native chart references a missing embedded Excel workbook") from exc
    _require(
        0 < info.file_size <= MAX_PART_BYTES,
        "A native chart embedded Excel workbook exceeds its bounded size",
    )
    try:
        workbook = zipfile.ZipFile(io.BytesIO(package.read(info)))
    except zipfile.BadZipFile as exc:
        raise ChartGateError(
            "A native chart embedded workbook is not a valid XLSX package"
        ) from exc
    with workbook:
        names = workbook.namelist()
        _require(
            0 < len(names) <= MAX_PACKAGE_PARTS
            and len(set(names)) == len(names)
            and sum(item.file_size for item in workbook.infolist()) <= MAX_PACKAGE_BYTES,
            "An embedded workbook contains duplicate or excessive package data",
        )
        root = _safe_xml(workbook, "xl/workbook.xml")
        _require(
            root.tag == "{" + NS["x"] + "}workbook",
            "An embedded workbook has no genuine workbook document",
        )
        relations = _safe_xml(workbook, "xl/_rels/workbook.xml.rels")
        targets: dict[str, str] = {}
        shared_strings: list[str] = []
        for relation in relations:
            identifier = relation.get("Id")
            _require(
                bool(identifier) and identifier not in targets,
                "An embedded workbook has duplicate or missing relationship identifiers",
            )
            # Other relationships, including hyperlinks, are never followed.
            targets[str(identifier)] = ""
            if relation.get("Type") not in {NS["r"] + "/worksheet", NS["r"] + "/sharedStrings"}:
                continue
            _require(
                relation.get("TargetMode", "Internal") == "Internal",
                "An embedded workbook worksheet or shared-string relationship is external",
            )
            target = _resolved_part("xl/workbook.xml", relation.get("Target"), root="xl")
            if relation.get("Type") == NS["r"] + "/worksheet":
                targets[str(identifier)] = target
            else:
                strings_root = _safe_xml(workbook, target)
                _require(
                    strings_root.tag == "{" + NS["x"] + "}sst",
                    "An embedded workbook shared-string part is invalid",
                )
                shared_strings = [_string_value(item) for item in strings_root.findall("x:si", NS)]
        sheets: dict[str, dict[str, WorkbookCell]] = {}
        numeric_count = 0
        for sheet in root.findall("x:sheets/x:sheet", NS):
            name = sheet.get("name", "")
            target = targets.get(sheet.get("{" + NS["r"] + "}id", ""))
            _require(
                bool(name) and name.casefold() not in sheets and bool(target),
                "An embedded workbook has a missing or ambiguous sheet relationship",
            )
            worksheet = _safe_xml(workbook, str(target))
            _require(
                worksheet.tag == "{" + NS["x"] + "}worksheet",
                "An embedded workbook sheet relationship does not identify a worksheet",
            )
            cells: dict[str, WorkbookCell] = {}
            for cell in worksheet.findall("x:sheetData/x:row/x:c", NS):
                address = cell.get("r", "").upper()
                _require(
                    re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]{0,6}", address) is not None
                    and address not in cells,
                    "An embedded workbook has a missing or duplicate cell coordinate",
                )
                value = cell.find("x:v", NS)
                kind = cell.get("t", "n")
                if kind == "inlineStr":
                    inline = cell.find("x:is", NS)
                    cells[address] = WorkbookCell(
                        "string", "" if inline is None else _string_value(inline)
                    )
                elif kind == "s":
                    index = "" if value is None else value.text or ""
                    _require(
                        index.isdigit() and int(index) < len(shared_strings),
                        "An embedded workbook cell references a missing shared string",
                    )
                    cells[address] = WorkbookCell("string", shared_strings[int(index)])
                elif kind == "str":
                    cells[address] = WorkbookCell(
                        "string", "" if value is None else value.text or ""
                    )
                elif kind == "n" and value is not None and value.text:
                    cells[address] = WorkbookCell("number", _decimal(value.text))
                    numeric_count += 1
                else:
                    cells[address] = WorkbookCell("unresolved", kind)
            sheets[name.casefold()] = cells
        _require(bool(sheets), "A native chart embedded workbook has no actual worksheet")
        return ChartWorkbook(sheets, numeric_count)


_RANGE = re.compile(
    r"(?P<sheet>'(?:[^']|'')+'|[^\s'!\[\]():,+*/^&=<>\-]+)!"
    r"\$?(?P<c1>[A-Za-z]{1,3})\$?(?P<r1>[1-9][0-9]{0,6})"
    r"(?::\$?(?P<c2>[A-Za-z]{1,3})\$?(?P<r2>[1-9][0-9]{0,6}))?\Z"
)


def _column_number(value: str) -> int:
    result = 0
    for character in value.upper():
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def _column_name(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def _referenced_cells(workbook: ChartWorkbook, formula: str, *, label: str) -> list[WorkbookCell]:
    match = _RANGE.fullmatch(formula.strip().removeprefix("="))
    _require(
        match is not None,
        f"{label}: unsupported chart formula; use one internal sheet-qualified A1 cell or contiguous row/column range and rerun validation",
    )
    assert match is not None
    sheet = match["sheet"]
    if sheet.startswith("'"):
        sheet = sheet[1:-1].replace("''", "'")
    _require(
        not any(character in sheet for character in "[]:\\/?*"),
        f"{label}: external workbook and three-dimensional sheet references require separate validation",
    )
    cells = workbook.sheets.get(sheet.casefold())
    _require(cells is not None, f"{label}: chart formula references a missing worksheet")
    assert cells is not None
    c1, c2 = _column_number(match["c1"]), _column_number(match["c2"] or match["c1"])
    r1, r2 = int(match["r1"]), int(match["r2"] or match["r1"])
    _require(
        c1 <= c2 <= 16384
        and r1 <= r2 <= 1_048_576
        and (c1 == c2 or r1 == r2)
        and max(c2 - c1, r2 - r1) < 100_000,
        f"{label}: chart formula must select a bounded, forward, one-dimensional Excel range",
    )
    selected = []
    for row in range(r1, r2 + 1):
        for column in range(c1, c2 + 1):
            address = f"{_column_name(column)}{row}"
            cell = cells.get(address)
            _require(
                cell is not None and cell.kind != "unresolved",
                f"{label}: referenced cell {address} is missing, blank, an error, or lacks a calculated value; recalculate the source workbook",
            )
            assert cell is not None
            selected.append(cell)
    return selected


def _chart_point_container(
    series: ElementTree.Element,
    role: str,
    *,
    numeric: bool,
) -> tuple[list[str], str]:
    parent = series.find("c:" + role, NS)
    _require(
        parent is not None,
        "Expected quantitative chart series is missing its category or numeric values",
    )
    branches = (("c:numLit", "literal"), ("c:numRef/c:numCache", "reference_cache"))
    if not numeric:
        branches = (
            ("c:strLit", "literal"),
            ("c:numLit", "literal"),
            ("c:strRef/c:strCache", "reference_cache"),
            ("c:numRef/c:numCache", "reference_cache"),
        )
    matches = [
        (container, kind)
        for expression, kind in branches
        for container in parent.findall(expression, NS)
    ]
    _require(
        len(matches) == 1, "Expected quantitative chart series has no unique literal or cached data"
    )
    container, kind = matches[0]
    if kind == "reference_cache":
        reference = next(
            (child for child in parent if child.tag.rsplit("}", 1)[-1] in {"numRef", "strRef"}),
            None,
        )
        formula = reference.find("c:f", NS) if reference is not None else None
        _require(
            formula is not None and isinstance(formula.text, str) and bool(formula.text.strip()),
            "Expected quantitative chart reference cache lacks its worksheet formula",
        )
    count = container.find("c:ptCount", NS)
    _require(
        count is not None and isinstance(count.get("val"), str) and count.get("val", "").isdigit(),
        "Expected quantitative chart literal/cache point count is missing or invalid",
    )
    declared = int(count.get("val", "0"))
    points = container.findall("c:pt", NS)
    _require(
        0 < declared <= 100_000 and len(points) == declared,
        "Expected quantitative chart literal/cache point count disagrees with its points",
    )
    seen: set[int] = set()
    values: dict[int, str] = {}
    for point in points:
        raw_index = point.get("idx")
        _require(
            isinstance(raw_index, str) and raw_index.isdigit(),
            "Expected quantitative chart literal/cache has an invalid point index",
        )
        index = int(raw_index)
        _require(
            index < declared and index not in seen,
            "Expected quantitative chart literal/cache repeats or exceeds a point index",
        )
        seen.add(index)
        item = point.find("c:v", NS)
        _require(
            item is not None
            and isinstance(item.text, str)
            and bool(item.text.strip())
            and len(item.text) <= 1000,
            "Expected quantitative chart literal/cache contains an empty point",
        )
        if numeric or container.tag.rsplit("}", 1)[-1] in {"numLit", "numCache"}:
            _decimal(item.text)
        values[index] = item.text
    # XML document order is not data order; DrawingML's pt/@idx is authoritative.
    return [values[index] for index in range(declared)], kind


def _reconcile_series_range(
    series: ElementTree.Element, role: str, *, numeric: bool, workbook: ChartWorkbook, ordinal: int
) -> int:
    values, kind = _chart_point_container(series, role, numeric=numeric)
    label = f"Chart series {ordinal} {role}"
    _require(
        kind == "reference_cache",
        f"{label}: durable chart data must reference its embedded workbook; literal data has no verified workbook lineage",
    )
    parent = series.find("c:" + role, NS)
    assert parent is not None
    references = parent.findall("c:numRef", NS) + parent.findall("c:strRef", NS)
    _require(len(references) == 1, f"{label}: chart has ambiguous workbook references")
    reference = references[0]
    formulas = reference.findall("c:f", NS)
    _require(
        len(formulas) == 1 and bool(formulas[0].text),
        f"{label}: chart needs exactly one workbook formula",
    )
    cells = _referenced_cells(workbook, formulas[0].text or "", label=label)
    _require(
        len(values) == len(cells),
        f"{label}: cache point count differs from the referenced worksheet range",
    )
    is_number = reference.tag == "{" + NS["c"] + "}numRef"
    for index, (value, cell) in enumerate(zip(values, cells, strict=True)):
        if is_number:
            matches = cell.kind == "number" and _decimal(value) == cell.value
        else:
            matches = cell.kind == "string" and value == cell.value
        _require(
            matches,
            f"{label}: cached point {index} differs from its exact referenced worksheet cell; refresh the chart cache from that range",
        )
    return len(values) if is_number else 0


def _reconcile_workbook_series(chart: ElementTree.Element, workbook: ChartWorkbook) -> int:
    series = chart.findall(".//c:ser", NS)
    _require(bool(series), "Expected quantitative chart contains no native data series")
    numeric_count = 0
    for ordinal, item in enumerate(series, 1):
        scatter = item.find("c:xVal", NS) is not None or item.find("c:yVal", NS) is not None
        roles = (("xVal", True), ("yVal", True)) if scatter else (("cat", False), ("val", True))
        categories, _ = _chart_point_container(item, roles[0][0], numeric=roles[0][1])
        values, _ = _chart_point_container(item, roles[1][0], numeric=True)
        _require(
            len(categories) == len(values),
            f"Chart series {ordinal}: category and value counts disagree",
        )
        for role, numeric in roles:
            numeric_count += _reconcile_series_range(
                item, role, numeric=numeric, workbook=workbook, ordinal=ordinal
            )
        if item.find("c:bubbleSize", NS) is not None:
            sizes, _ = _chart_point_container(item, "bubbleSize", numeric=True)
            _require(
                len(sizes) == len(values), f"Chart series {ordinal}: bubble-size count disagrees"
            )
            numeric_count += _reconcile_series_range(
                item, "bubbleSize", numeric=True, workbook=workbook, ordinal=ordinal
            )
        if item.find("c:tx/c:strRef", NS) is not None:
            _reconcile_series_range(item, "tx", numeric=False, workbook=workbook, ordinal=ordinal)
    return numeric_count


def _powerpoint_series(chart: ElementTree.Element) -> dict[str, Any]:
    series = chart.findall(".//c:ser", NS)
    _require(bool(series), "Expected quantitative chart contains no native data series")
    literal_points = cached_points = 0
    for item in series:
        scatter = item.find("c:xVal", NS) is not None or item.find("c:yVal", NS) is not None
        category_role, value_role = ("xVal", "yVal") if scatter else ("cat", "val")
        categories, _ = _chart_point_container(item, category_role, numeric=scatter)
        values, mode = _chart_point_container(item, value_role, numeric=True)
        _require(
            len(categories) == len(values),
            "Expected quantitative chart category and numeric value counts disagree",
        )
        if item.find("c:bubbleSize", NS) is not None:
            sizes, _ = _chart_point_container(item, "bubbleSize", numeric=True)
            _require(
                len(sizes) == len(values),
                "Expected quantitative chart bubble-size and numeric value counts disagree",
            )
        if mode == "literal":
            literal_points += len(values)
        else:
            cached_points += len(values)
    _require(
        literal_points + cached_points > 0,
        "Expected quantitative chart contains no editable native numeric data",
    )
    return {
        "series_count": len(series),
        "literal_numeric_point_count": literal_points,
        "numeric_cache_point_count": cached_points,
    }


def _native_chart(
    package: zipfile.ZipFile,
    *,
    slide_path: str,
    chart_reference: ElementTree.Element,
    slide_relationships: Mapping[str, Mapping[str, str]],
    content_types: Mapping[str, str],
    target_application: str,
    durable_required: bool,
) -> dict[str, Any]:
    relationship_id = chart_reference.get("{" + NS["r"] + "}id")
    relation = slide_relationships.get(str(relationship_id or ""))
    _require(
        relation is not None
        and relation.get("type") == CHART_RELATIONSHIP
        and relation.get("mode") == "Internal",
        "Expected quantitative chart lacks its exact slide-to-native-chart relationship",
    )
    path = str(relation["target"])
    _require(
        content_types.get(path) == CHART_CONTENT_TYPE,
        "Expected quantitative chart package part has an invalid chart content type",
    )
    chart = _safe_xml(package, path)
    _require(
        chart.tag == "{" + NS["c"] + "}chartSpace",
        "Expected quantitative chart is not a genuine DrawingML chartSpace",
    )
    plot = chart.find(".//c:plotArea", NS)
    _require(plot is not None, "Expected quantitative chart contains no native chart plot area")
    types = [
        element.tag.rsplit("}", 1)[-1]
        for element in plot
        if element.tag.rsplit("}", 1)[-1] in SUPPORTED_CHART_TYPES
    ]
    _require(bool(types), "Expected quantitative chart does not contain a supported native chart")
    native_data = _powerpoint_series(chart)
    formulas = [
        item.text
        for item in chart.findall(".//c:f", NS)
        if isinstance(item.text, str) and item.text.strip()
    ]
    external = chart.findall("./c:externalData", NS)
    if target_application == "powerpoint" and not durable_required and not external:
        _require(
            not formulas
            and not chart.findall(".//c:numRef", NS)
            and not chart.findall(".//c:strRef", NS),
            "Cached-reference chart lacks its embedded workbook; restore the original workbook before claiming editable chart validation",
        )
        return {
            "native_chart_types": sorted(set(types)),
            "embedded_workbook_count": 0,
            "embedded_workbook_sheet_count": 0,
            "series_formula_count": len(formulas),
            "numeric_cache_point_count": native_data["numeric_cache_point_count"],
            "literal_numeric_point_count": native_data["literal_numeric_point_count"],
            "workbook_numeric_cell_count": 0,
            "editability_evidence": "powerpoint_native_literal"
            if native_data["literal_numeric_point_count"]
            else "powerpoint_cached_reference",
        }
    _require(
        len(external) == 1,
        "Expected quantitative chart lacks a unique embedded Excel externalData relationship",
    )
    external_id = external[0].get("{" + NS["r"] + "}id")
    chart_relations = _relationships(package, path)
    workbook = chart_relations.get(str(external_id or ""))
    _require(
        workbook is not None
        and workbook.get("type") == WORKBOOK_RELATIONSHIP
        and workbook.get("mode") == "Internal",
        "Expected quantitative chart does not resolve its embedded Excel package relationship",
    )
    workbook_path = str(workbook["target"])
    _require(
        workbook_path.endswith(".xlsx")
        and content_types.get(workbook_path) == WORKBOOK_CONTENT_TYPE,
        "Expected quantitative chart embedded workbook has an invalid XLSX content type",
    )
    workbook_cells = _workbook_cells(package, workbook_path)
    numeric_point_count = _reconcile_workbook_series(chart, workbook_cells)
    result = {
        "native_chart_types": sorted(set(types)),
        "embedded_workbook_count": 1,
        "embedded_workbook_sheet_count": len(workbook_cells.sheets),
        "series_formula_count": len(formulas),
        "numeric_cache_point_count": numeric_point_count,
        "workbook_numeric_cell_count": workbook_cells.numeric_cell_count,
        "cache_reference_ranges_verified": True,
    }
    if target_application == "powerpoint":
        result["editability_evidence"] = "embedded_workbook"
        result["literal_numeric_point_count"] = (
            native_data["literal_numeric_point_count"] if native_data is not None else 0
        )
    return result


def _exception_policy(value: Any) -> SourceFigureException:
    if isinstance(value, SourceFigureException):
        result = value
    elif isinstance(value, Mapping) and set(value) == {"user_approved", "policy"}:
        result = SourceFigureException(value["user_approved"], value["policy"])
    else:
        raise ChartGateError(
            "A noneditable source-figure exception must be explicit and slide-specific"
        )
    _require(
        result.user_approved is True and result.policy == SAFE_POLICY,
        "A noneditable source figure requires explicit user approval and the exact safe policy",
    )
    return result


def _source_figure_disclosed(slide: ElementTree.Element) -> bool:
    text = " ".join((item.text or "") for item in slide.findall(".//a:t", NS))
    return bool(_DISCLOSURE.search(text)) and bool(
        re.search(r"\b(?:source|figure|image)\b", text, re.I)
    )


def _slide_result(
    package: zipfile.ZipFile,
    slide_number: int,
    path: str,
    *,
    required_charts: int,
    content_types: Mapping[str, str],
    exception: SourceFigureException | None,
    target_application: str,
    durable_required: bool,
) -> dict[str, Any]:
    slide = _safe_xml(package, path)
    pictures = slide.findall(".//p:pic", NS)
    frames = slide.findall(".//p:graphicFrame", NS)
    references = []
    for frame in frames:
        references.extend(frame.findall(".//a:graphic/a:graphicData/c:chart", NS))
    result: dict[str, Any] = {
        "slide_number": slide_number,
        "required_native_chart_count": required_charts,
        "native_chart_count": len(references),
        "raster_picture_count": len(pictures),
        "approved_source_figure_exception": False,
        "failure_codes": [],
    }
    if len(references) < required_charts:
        if exception is not None and pictures and _source_figure_disclosed(slide):
            result["status"] = "approved_source_figure_exception"
            result["approved_source_figure_exception"] = True
            return result
        if exception is not None and pictures:
            result["failure_codes"].append("approved_source_figure_missing_noneditable_disclosure")
        elif pictures:
            result["failure_codes"].append("raster_picture_is_not_native_chart")
        result["failure_codes"].append("required_native_chart_missing")
        result["status"] = "failed"
        return result

    try:
        relationships = _relationships(package, path)
        checks = [
            _native_chart(
                package,
                slide_path=path,
                chart_reference=reference,
                slide_relationships=relationships,
                content_types=content_types,
                target_application=target_application,
                durable_required=durable_required,
            )
            for reference in references
        ]
    except ChartGateError as exc:
        result["status"] = "failed"
        result["failure_codes"].append("native_chart_workbook_contract_failed")
        result["failure_detail"] = str(exc)
        return result
    result["status"] = "passed"
    result["charts"] = checks
    return result


def discover_native_chart_owners(presentation: str | Path) -> dict[str, Any]:
    """List actual native chart frames only; never infer source-required owners."""

    path = Path(presentation)
    _require(
        path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= MAX_PACKAGE_BYTES,
        "The selected PowerPoint is not a bounded regular presentation file",
    )
    try:
        package = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ChartGateError("The selected PowerPoint is not a valid Office package") from exc
    with package:
        names = package.namelist()
        _require(
            0 < len(names) <= MAX_PACKAGE_PARTS and len(set(names)) == len(names),
            "The selected PowerPoint has unsafe duplicate or excessive package entries",
        )
        _require(
            package.testzip() is None,
            "The selected PowerPoint has a corrupt compressed package part",
        )
        ordered = logical_presentation_slides(package)
        owners: dict[int, int] = {}
        for slide_number, name in ordered.items():
            root = _safe_xml(package, name)
            references = []
            for frame in root.findall(".//p:graphicFrame", NS):
                references.extend(frame.findall(".//a:graphic/a:graphicData/c:chart", NS))
            if references:
                _require(
                    len(references) <= MAX_CHARTS_PER_SLIDE,
                    "A native chart slide exceeds its bounded chart-owner limit",
                )
                owners[slide_number] = len(references)
        _require(
            len(owners) <= MAX_EXPECTED_SLIDES,
            "The selected PowerPoint exceeds its bounded native-chart owner limit",
        )
    return {
        "schema_version": "owner-private.actual-native-chart-discovery.v1",
        "package_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "slide_count": len(ordered),
        "chart_owner_slides": sorted(owners),
        "chart_owner_slide_parts": {str(slide): ordered[slide] for slide in sorted(owners)},
        "chart_counts": {str(slide): owners[slide] for slide in sorted(owners)},
        "chart_count": sum(owners.values()),
        "source_attachments_accessed": False,
        "source_required_chart_owners_inferred": False,
    }


def audit_native_quantitative_charts(
    presentation: str | Path,
    expected_chart_slides: Iterable[int] | Mapping[int, int],
    *,
    approved_source_figures: Mapping[int, SourceFigureException | Mapping[str, Any]] | None = None,
    target_application: str = "portable",
    required_embedded_workbook_slides: Iterable[int] = (),
) -> dict[str, Any]:
    """Validate only explicitly expected quantitative charts; never inspect source attachments."""

    _require(
        isinstance(target_application, str) and target_application in {"portable", "powerpoint"},
        "Chart target application must be explicitly portable or PowerPoint",
    )
    path = Path(presentation)
    _require(
        path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= MAX_PACKAGE_BYTES,
        "The selected PowerPoint is not a bounded regular presentation file",
    )
    if isinstance(expected_chart_slides, Mapping):
        expected = dict(expected_chart_slides)
    else:
        sequence = list(expected_chart_slides)
        _require(
            len(sequence) == len(set(sequence)),
            "Expected quantitative chart slide numbers cannot be duplicated",
        )
        expected = {item: 1 for item in sequence}
    _require(
        0 < len(expected) <= MAX_EXPECTED_SLIDES,
        "At least one explicitly expected quantitative chart slide is required",
    )
    _require(
        all(
            type(slide) is int
            and slide > 0
            and type(count) is int
            and 1 <= count <= MAX_CHARTS_PER_SLIDE
            for slide, count in expected.items()
        ),
        "Expected quantitative chart slides and chart counts must be bounded positive integers",
    )
    try:
        durable = list(required_embedded_workbook_slides)
    except TypeError as exc:
        raise ChartGateError(
            "Durable embedded-workbook owners must be unique declared chart-owner slides"
        ) from exc
    _require(
        all(type(slide) is int and slide in expected for slide in durable)
        and len(durable) == len(set(durable)),
        "Durable embedded-workbook owners must be unique declared chart-owner slides",
    )
    durable_owners = set(durable)
    exceptions: dict[int, SourceFigureException] = {}
    for slide, policy in (approved_source_figures or {}).items():
        _require(
            type(slide) is int and slide in expected,
            "A source-figure exception must target an explicitly expected quantitative slide",
        )
        exceptions[slide] = _exception_policy(policy)
    try:
        package = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ChartGateError("The selected PowerPoint is not a valid Office package") from exc
    with package:
        names = package.namelist()
        _require(
            0 < len(names) <= MAX_PACKAGE_PARTS and len(set(names)) == len(names),
            "The selected PowerPoint has unsafe duplicate or excessive package entries",
        )
        _require(
            package.testzip() is None,
            "The selected PowerPoint has a corrupt compressed package part",
        )
        actual_slides = logical_presentation_slides(package)
        _require(
            all(number in actual_slides for number in expected),
            "An explicitly expected quantitative chart slide is absent from the presentation",
        )
        types = _content_types(package)
        results = [
            _slide_result(
                package,
                slide,
                actual_slides[slide],
                required_charts=expected[slide],
                content_types=types,
                exception=exceptions.get(slide),
                target_application=target_application,
                durable_required=target_application == "portable" or slide in durable_owners,
            )
            for slide in sorted(expected)
        ]
    failures = [entry["slide_number"] for entry in results if entry["status"] == "failed"]
    return {
        "schema_version": "owner-private.quantitative-chart-native-gate.v1",
        "package_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "slide_count": len(actual_slides),
        "expected_quantitative_chart_slides": sorted(expected),
        "validated_slide_count": len(results),
        "failed_slide_count": len(failures),
        "failed_slides": failures,
        "passed": not failures,
        "results": results,
        "source_attachments_accessed": False,
        "native_application_open_verified": False,
        "formal_human_reviewed": False,
        "claim_boundary": "OOXML/workbook structural validation only; source provenance and native PowerPoint opening remain separate checks.",
        **(
            {
                "target_application": target_application,
                "required_embedded_workbook_slides": sorted(durable_owners),
            }
            if target_application != "portable" or durable_owners
            else {}
        ),
    }


def write_private_receipt(path: str | Path, payload: Mapping[str, Any]) -> Path:
    destination = Path(path)
    _require(
        destination.parent.resolve() == ROOT.resolve(),
        "Source-free chart receipts must remain inside the owner-private enforcement directory",
    )
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    ROOT.chmod(0o700)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".chart-gate-", dir=ROOT)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            # mkstemp creates a private POSIX file. Windows Python 3.12 has no
            # fchmod and uses the selected workspace's inherited ACL instead.
            if hasattr(os, "fchmod"):
                os.fchmod(handle.fileno(), 0o600)
            handle.write(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(destination)
        destination.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("presentation", type=Path)
    parser.add_argument(
        "--expected-chart-slides", help="Comma-separated one-based quantitative-chart slide numbers"
    )
    parser.add_argument(
        "--discover-chart-slides",
        action="store_true",
        help="Report actual native chart owners without inventing source requirements",
    )
    parser.add_argument(
        "--approved-source-figure",
        action="append",
        default=[],
        type=int,
        help="Explicit user-approved slide-specific source-figure exception",
    )
    parser.add_argument(
        "--target-application",
        choices=("portable", "powerpoint"),
        default="portable",
        help="Only explicit PowerPoint targeting permits native literal chart data",
    )
    parser.add_argument(
        "--require-embedded-workbook-slide",
        action="append",
        default=[],
        type=int,
        help="Explicit source-approved chart slide requiring a durable embedded workbook",
    )
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args(argv)
    if args.discover_chart_slides:
        _require(
            args.expected_chart_slides is None
            and not args.approved_source_figure
            and not args.require_embedded_workbook_slide
            and args.receipt is None,
            "Chart discovery cannot include source-owner, exception, durability, or receipt options",
        )
        print(
            json.dumps(
                discover_native_chart_owners(args.presentation),
                sort_keys=True,
                separators=(",", ":"),
            )
        )
        return 0
    _require(
        args.expected_chart_slides is not None,
        "Declare expected chart owners or explicitly request actual chart discovery",
    )
    try:
        expected = [int(item) for item in args.expected_chart_slides.split(",")]
    except ValueError as exc:
        raise ChartGateError(
            "Expected quantitative chart slides must be positive integers"
        ) from exc
    exceptions = {
        number: SourceFigureException(user_approved=True) for number in args.approved_source_figure
    }
    payload = audit_native_quantitative_charts(
        args.presentation,
        expected,
        approved_source_figures=exceptions,
        target_application=args.target_application,
        required_embedded_workbook_slides=(args.require_embedded_workbook_slide),
    )
    if args.receipt is not None:
        write_private_receipt(args.receipt, payload)
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ChartGateError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        raise SystemExit(2) from exc
