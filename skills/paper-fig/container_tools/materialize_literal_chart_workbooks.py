#!/usr/bin/env python3
"""Experimental: snapshot complete literal chart data into an honest embedded XLSX.

A snapshot creates new chart-owned worksheet formulas.  It never recovers,
preserves, or claims lineage to an original source workbook or its formulas.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
import posixpath
import sys
import tempfile
import zipfile
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from urllib.parse import urlsplit

try:
    from lxml import etree
except ImportError as error:  # pragma: no cover: fail closed on unsupported runtime.
    raise RuntimeError(
        "The experimental chart snapshot requires the bundled lxml parser"
    ) from error

HERE = Path(__file__).resolve().parent
GATE_PATH = HERE / "native_quantitative_chart_gate.py"
SPEC = importlib.util.spec_from_file_location("literal_chart_snapshot_gate", GATE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("The packaged native-chart gate is unavailable")
GATE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GATE
SPEC.loader.exec_module(GATE)

NS = GATE.NS
C = NS["c"]
R = NS["r"]
P = NS["p"]
A = NS["a"]
REL = NS["rel"]
X = NS["x"]
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MAX_PARTS = GATE.MAX_PACKAGE_PARTS
MAX_BYTES = GATE.MAX_PACKAGE_BYTES
MAX_POINTS = 100_000
MAX_TEXT = 2_000
MAX_SERIES = 128
SNAPSHOT_PREFIX = "ppt/embeddings/chart-data-snapshot-"
WORKBOOK_MIME = GATE.WORKBOOK_CONTENT_TYPE
CHART_MIME = GATE.CHART_CONTENT_TYPE


class SnapshotError(ValueError):
    """Source-safe unsupported chart lineage or invalid native data."""


def _require(value: bool, message: str) -> None:
    if not value:
        raise SnapshotError(message)


def _parse(data: bytes, label: str) -> etree._Element:
    _require(
        data and len(data) <= GATE.MAX_PART_BYTES and b"<!DOCTYPE" not in data.upper(),
        f"{label} is unsafe, empty, or exceeds the bounded XML limit",
    )
    try:
        return etree.fromstring(
            data,
            parser=etree.XMLParser(
                resolve_entities=False,
                no_network=True,
                load_dtd=False,
                recover=False,
                huge_tree=False,
                remove_blank_text=False,
            ),
        )
    except (etree.XMLSyntaxError, ValueError) as error:
        raise SnapshotError(f"{label} is malformed") from error


def _bytes(root: etree._Element, original: bytes | None = None) -> bytes:
    declaration = bool(original and original.lstrip().startswith(b"<?xml"))
    return etree.tostring(
        root, encoding="UTF-8", xml_declaration=declaration, standalone=None, pretty_print=False
    )


def _q(namespace: str, name: str) -> str:
    return "{" + namespace + "}" + name


def _with_relationship_namespace(root: etree._Element) -> etree._Element:
    """Preserve every original root namespace and add the missing binding only."""
    if any(uri == R for uri in root.nsmap.values()):
        return root
    namespaces = dict(root.nsmap)
    prefix = "r"
    number = 1
    while prefix in namespaces:
        prefix = f"chartRelationship{number}"
        number += 1
    namespaces[prefix] = R
    rebound = etree.Element(root.tag, nsmap=namespaces)
    rebound.text = root.text
    rebound.tail = root.tail
    for name, value in root.attrib.items():
        rebound.set(name, value)
    for child in root:
        rebound.append(child)
    return rebound


def _text(value: str, label: str) -> str:
    _require(
        isinstance(value, str) and bool(value.strip()) and len(value) <= MAX_TEXT,
        f"{label} must contain bounded, nonempty text",
    )
    _require(
        not any(ord(character) < 32 and character not in "\t\n\r" for character in value),
        f"{label} contains unsafe XML control characters",
    )
    return value


def _numeric(value: str) -> str:
    _text(value, "Numeric chart value")
    _require(len(value) <= 100, "Numeric chart value exceeds its bounded precision")
    try:
        decimal = Decimal(value)
    except InvalidOperation as error:
        raise SnapshotError("Numeric chart value is malformed") from error
    _require(decimal.is_finite(), "Numeric chart values must be finite")
    _require(
        len(decimal.normalize().as_tuple().digits) <= 15,
        "Excel cannot preserve the literal chart's numeric precision",
    )
    return value


def _column(number: int) -> str:
    _require(1 <= number <= 16384, "Chart snapshot exceeds Excel's bounded column capacity")
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _literal(
    parent: etree._Element, *, numeric: bool, allow_strings: bool
) -> tuple[etree._Element, list[str], str]:
    types = ("numLit",) if numeric else (("strLit", "numLit") if allow_strings else ("numLit",))
    found = [(child, kind) for kind in types for child in parent.findall("c:" + kind, NS)]
    _require(
        len(found) == 1,
        "Every chart category/value series must contain exactly one complete self-contained literal",
    )
    element, kind = found[0]
    _require(
        not any(child.tag in {_q(C, "numRef"), _q(C, "strRef")} for child in parent),
        "Existing workbook references cannot be replaced by a synthetic snapshot",
    )
    count = element.find("c:ptCount", NS)
    points = element.findall("c:pt", NS)
    _require(
        count is not None and isinstance(count.get("val"), str) and count.get("val", "").isdigit(),
        "Literal chart series must provide an exact point count",
    )
    expected = int(count.get("val", "0"))
    _require(
        0 < expected <= MAX_POINTS and len(points) == expected,
        "Literal chart point count does not match its complete values",
    )
    values: dict[int, str] = {}
    for point in points:
        raw_index = point.get("idx", "")
        _require(
            raw_index.isdigit() and int(raw_index) < expected and int(raw_index) not in values,
            "Literal chart point indices must be unique and contiguous",
        )
        index = int(raw_index)
        item = point.find("c:v", NS)
        _require(
            item is not None and isinstance(item.text, str),
            "Literal chart point is missing its original value",
        )
        values[index] = (
            _numeric(item.text)
            if numeric or kind == "numLit"
            else _text(item.text, "Chart category")
        )
    return element, [values[index] for index in range(expected)], kind


def _series_name(series: etree._Element, ordinal: int) -> str:
    title = series.find("c:tx", NS)
    if title is None:
        return f"Series {ordinal}"
    _require(
        not title.findall(".//c:f", NS) and not title.findall(".//c:strRef", NS),
        "An original source-bound series title cannot be replaced by snapshot lineage",
    )
    direct = title.find("c:v", NS)
    if direct is not None and isinstance(direct.text, str):
        return _text(direct.text, "Chart series title")
    values = title.findall(".//c:pt/c:v", NS)
    if len(values) == 1 and isinstance(values[0].text, str):
        return _text(values[0].text, "Chart series title")
    return f"Series {ordinal}"


def _replace_literal(
    parent: etree._Element, element: etree._Element, *, kind: str, formula: str
) -> None:
    reference = etree.Element(_q(C, "strRef" if kind == "strLit" else "numRef"))
    formula_node = etree.SubElement(reference, _q(C, "f"))
    formula_node.text = formula
    cache = etree.SubElement(reference, _q(C, "strCache" if kind == "strLit" else "numCache"))
    for child in element:
        cache.append(deepcopy(child))
    parent.replace(element, reference)


def _inline_cell(parent: etree._Element, coordinate: str, text: str) -> None:
    cell = etree.SubElement(parent, _q(X, "c"), r=coordinate, t="inlineStr")
    inline = etree.SubElement(cell, _q(X, "is"))
    item = etree.SubElement(inline, _q(X, "t"))
    if text != text.strip():
        item.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    # Explicit inlineStr guarantees '=...', '+...', '-', or '@' remain inert text.
    item.text = text


def _numeric_cell(parent: etree._Element, coordinate: str, value: str) -> None:
    cell = etree.SubElement(parent, _q(X, "c"), r=coordinate)
    etree.SubElement(cell, _q(X, "v")).text = _numeric(value)


def _workbook(series: list[dict[str, Any]]) -> bytes:
    width = len(series) * 2
    height = max(len(item["categories"]) for item in series) + 1
    _require(height <= 1_048_576, "Chart snapshot exceeds Excel's bounded row capacity")
    worksheet = etree.Element(_q(X, "worksheet"), nsmap={None: X})
    etree.SubElement(worksheet, _q(X, "dimension"), ref=f"A1:{_column(width)}{height}")
    sheet_data = etree.SubElement(worksheet, _q(X, "sheetData"))
    for row_number in range(1, height + 1):
        row = etree.SubElement(sheet_data, _q(X, "row"), r=str(row_number))
        for ordinal, item in enumerate(series):
            category_column = _column(ordinal * 2 + 1)
            value_column = _column(ordinal * 2 + 2)
            if row_number == 1:
                _inline_cell(row, f"{category_column}1", "X" if item["scatter"] else "Category")
                _inline_cell(row, f"{value_column}1", item["name"])
                continue
            index = row_number - 2
            if index >= len(item["categories"]):
                continue
            category = item["categories"][index]
            if item["category_kind"] == "numLit":
                _numeric_cell(row, f"{category_column}{row_number}", category)
            else:
                _inline_cell(row, f"{category_column}{row_number}", category)
            _numeric_cell(row, f"{value_column}{row_number}", item["values"][index])

    workbook = etree.Element(_q(X, "workbook"), nsmap={None: X, "r": R})
    sheets = etree.SubElement(workbook, _q(X, "sheets"))
    sheet = etree.SubElement(sheets, _q(X, "sheet"), name="Chart Data", sheetId="1")
    sheet.set(_q(R, "id"), "rId1")
    package_relations = etree.Element(_q(REL, "Relationships"), nsmap={None: REL})
    etree.SubElement(
        package_relations,
        _q(REL, "Relationship"),
        Id="rId1",
        Type=OFFICE_REL + "/officeDocument",
        Target="xl/workbook.xml",
    )
    workbook_relations = etree.Element(_q(REL, "Relationships"), nsmap={None: REL})
    etree.SubElement(
        workbook_relations,
        _q(REL, "Relationship"),
        Id="rId1",
        Type=OFFICE_REL + "/worksheet",
        Target="worksheets/sheet1.xml",
    )
    types = etree.Element(_q(CT, "Types"), nsmap={None: CT})
    etree.SubElement(
        types,
        _q(CT, "Default"),
        Extension="rels",
        ContentType="application/vnd.openxmlformats-package.relationships+xml",
    )
    etree.SubElement(types, _q(CT, "Default"), Extension="xml", ContentType="application/xml")
    etree.SubElement(
        types,
        _q(CT, "Override"),
        PartName="/xl/workbook.xml",
        ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    )
    etree.SubElement(
        types,
        _q(CT, "Override"),
        PartName="/xl/worksheets/sheet1.xml",
        ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for name, root in (
            ("[Content_Types].xml", types),
            ("_rels/.rels", package_relations),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_relations),
            ("xl/worksheets/sheet1.xml", worksheet),
        ):
            package.writestr(name, _bytes(root))
    payload = out.getvalue()
    _require(
        0 < len(payload) <= GATE.MAX_PART_BYTES,
        "Generated chart data snapshot exceeds its bounded workbook size",
    )
    return payload


def _source_policies(value: Iterable[int], *, label: str, owners: set[int]) -> set[int]:
    try:
        slides = list(value)
    except TypeError as error:
        raise SnapshotError(f"{label} must list actual native chart-owner slides") from error
    _require(
        all(type(number) is int and number in owners for number in slides)
        and len(slides) == len(set(slides)),
        f"{label} must list unique, actual native chart-owner slides",
    )
    return set(slides)


def _validate_chart_relationships(root: etree._Element) -> None:
    identities: set[str] = set()
    for item in root.findall("rel:Relationship", NS):
        identifier = item.get("Id", "")
        target = item.get("Target", "")
        _require(
            bool(identifier and target) and identifier not in identities,
            "Chart relationships must have unique identifiers and nonempty targets",
        )
        identities.add(identifier)
        mode = item.get("TargetMode", "Internal").casefold()
        _require(mode in {"internal", "external"}, "Invalid chart relationship mode")
        if mode == "internal":
            continue
        try:
            parsed = urlsplit(target)
            safe_link = (
                item.get("Type") == R + "/hyperlink"
                and not any(ord(character) <= 32 or ord(character) == 127 for character in target)
                and "\\" not in target
                and (
                    parsed.scheme.casefold() in {"http", "https"}
                    and bool(parsed.hostname)
                    or parsed.scheme.casefold() == "mailto"
                    and bool(parsed.path)
                    and not parsed.netloc
                )
            )
        except ValueError:
            safe_link = False
        # Clickable hyperlinks are inert here and remain byte-for-byte intact on
        # preserved charts. Never fetch them or admit external chart data/media.
        _require(
            safe_link,
            "External chart resources are forbidden; only ordinary HTTP(S) or mailto hyperlinks may be preserved",
        )


def _validate_paths(
    source: str | Path, destination: str | Path, receipt: str | Path, workspace: str | Path
) -> tuple[Path, Path, Path, Path]:
    values = [Path(item) for item in (source, destination, receipt, workspace)]
    _require(
        all(path.is_absolute() for path in values),
        "Chart snapshot requires exact absolute staged input/output/receipt/workspace paths",
    )
    input_path, output_path, receipt_path, workspace_path = values
    _require(
        workspace_path.is_dir() and not workspace_path.is_symlink(),
        "Chart snapshot workspace must be an existing regular directory",
    )
    canonical = workspace_path.resolve()
    _require(
        input_path.is_file()
        and not input_path.is_symlink()
        and input_path.suffix.lower() == ".pptx"
        and 0 < input_path.stat().st_size <= MAX_BYTES
        and input_path.resolve().is_relative_to(canonical),
        "Chart snapshot input must be an approved bounded staged PPTX",
    )
    _require(
        output_path.suffix.lower() == ".pptx"
        and receipt_path.suffix.lower() == ".json"
        and output_path != input_path
        and output_path != receipt_path
        and output_path.parent.is_dir()
        and receipt_path.parent.is_dir()
        and output_path.parent.resolve().is_relative_to(canonical)
        and receipt_path.parent.resolve().is_relative_to(canonical)
        and not output_path.exists()
        and not output_path.is_symlink()
        and not receipt_path.exists()
        and not receipt_path.is_symlink(),
        "Chart snapshot output and truthful receipt must be new private staged workspace files",
    )
    return input_path, output_path, receipt_path, canonical


def materialize_literal_chart_workbooks(
    source: str | Path,
    destination: str | Path,
    *,
    receipt: str | Path,
    workspace: str | Path,
    source_formula_required_slides: Iterable[int] = (),
    source_workbook_required_slides: Iterable[int] = (),
) -> dict[str, Any]:
    """Convert only literal charts into explicitly new, self-contained data snapshots."""

    input_path, output_path, receipt_path, _ = _validate_paths(
        source, destination, receipt, workspace
    )
    original_bytes = input_path.read_bytes()
    original_sha = hashlib.sha256(original_bytes).hexdigest()
    try:
        archive = zipfile.ZipFile(io.BytesIO(original_bytes))
    except zipfile.BadZipFile as error:
        raise SnapshotError("Chart snapshot input is not a valid Office ZIP package") from error

    with archive:
        names = archive.namelist()
        _require(
            0 < len(names) <= MAX_PARTS
            and len(set(names)) == len(names)
            and not any(
                name.startswith("/") or ".." in PurePosixPath(name).parts for name in names
            ),
            "Chart snapshot input contains duplicate, unsafe, or excessive package parts",
        )
        _require(
            archive.testzip() is None,
            "Chart snapshot input has a corrupted compressed package part",
        )
        _require(
            "[Content_Types].xml" in names and "ppt/presentation.xml" in names,
            "Chart snapshot input lacks required Office presentation package parts",
        )
        discovery = GATE.discover_native_chart_owners(input_path)
        owner_slides = set(discovery["chart_owner_slides"])
        _require(owner_slides, "Chart snapshot requires at least one actual native chart")
        formula_required = _source_policies(
            source_formula_required_slides, label="Source-formula obligations", owners=owner_slides
        )
        workbook_required = _source_policies(
            source_workbook_required_slides,
            label="Original source-workbook obligations",
            owners=owner_slides,
        )
        content_original = archive.read("[Content_Types].xml")
        types = _parse(content_original, "Presentation content types")
        _require(
            types.tag == _q(CT, "Types") and types.nsmap.get(None) == CT,
            "Presentation content types must already use the canonical default namespace",
        )
        content = GATE._content_types(archive)
        modifications: dict[str, bytes] = {}
        additions: dict[str, bytes] = {}
        converted = []
        preserved = []
        seen_parts = set()

        for slide in sorted(owner_slides):
            slide_part = discovery["chart_owner_slide_parts"].get(str(slide))
            _require(
                isinstance(slide_part, str) and slide_part in names,
                "Actual logical native chart owner slide is missing",
            )
            slide_root = _parse(archive.read(slide_part), "Native chart owner slide")
            slide_rels = GATE._relationships(archive, slide_part)
            references = []
            for frame in slide_root.findall(".//p:graphicFrame", NS):
                references.extend(frame.findall(".//a:graphic/a:graphicData/c:chart", NS))
            for chart in references:
                identifier = chart.get(_q(R, "id"))
                relation = slide_rels.get(str(identifier or ""))
                _require(
                    relation is not None
                    and relation.get("type") == GATE.CHART_RELATIONSHIP
                    and relation.get("mode") == "Internal",
                    "Native chart relationship must be internal and complete",
                )
                chart_part = str(relation["target"])
                _require(
                    chart_part not in seen_parts
                    and chart_part in names
                    and content.get(chart_part) == CHART_MIME,
                    "Native chart part is missing, duplicated, or has the wrong content type",
                )
                seen_parts.add(chart_part)
                chart_original = archive.read(chart_part)
                chart_root = _parse(chart_original, "Native chart XML")
                _require(
                    chart_root.tag == _q(C, "chartSpace"),
                    "Native chart must preserve its original chart namespace",
                )
                external = chart_root.findall("./c:externalData", NS)
                relation_part = str(
                    PurePosixPath(chart_part).parent
                    / "_rels"
                    / (PurePosixPath(chart_part).name + ".rels")
                )
                if relation_part in names:
                    relation_original = archive.read(relation_part)
                    relation_root = _parse(relation_original, "Native chart relationships")
                    _require(
                        relation_root.tag == _q(REL, "Relationships")
                        and relation_root.nsmap.get(None) == REL,
                        "Native chart relationships must retain their default package namespace",
                    )
                    _validate_chart_relationships(relation_root)
                else:
                    relation_original = None
                    relation_root = etree.Element(_q(REL, "Relationships"), nsmap={None: REL})

                if external:
                    _require(
                        len(external) == 1, "An existing chart has duplicate workbook bindings"
                    )
                    chart_relationships = GATE._relationships(archive, chart_part)
                    workbook_relation = chart_relationships.get(
                        str(external[0].get(_q(R, "id")) or "")
                    )
                    _require(
                        workbook_relation is not None
                        and workbook_relation.get("type") == GATE.WORKBOOK_RELATIONSHIP
                        and workbook_relation.get("mode") == "Internal"
                        and str(workbook_relation.get("target", "")) in names,
                        "An existing original workbook relationship is broken; never synthesize lineage",
                    )
                    preserved.append({"owner_slide": slide, "chart_part": chart_part})
                    continue

                _require(
                    slide not in formula_required and slide not in workbook_required,
                    "A literal snapshot cannot preserve expressly required original source formulas or workbook",
                )
                _require(
                    not chart_root.findall(".//c:f", NS)
                    and not chart_root.findall(".//c:numRef", NS)
                    and not chart_root.findall(".//c:strRef", NS),
                    "An existing referenced chart lacks its source workbook; never fabricate formula provenance",
                )
                _require(
                    not chart_root.findall(".//c:bubbleSize", NS),
                    "Bubble-size literal charts require an explicitly supported source-preserving adapter",
                )
                chart_root = _with_relationship_namespace(chart_root)
                plot = chart_root.find(".//c:plotArea", NS)
                _require(
                    plot is not None
                    and any(
                        child.tag.rsplit("}", 1)[-1] in GATE.SUPPORTED_CHART_TYPES for child in plot
                    ),
                    "Only supported genuine native chart families may be snapshotted",
                )
                series_nodes = chart_root.findall(".//c:ser", NS)
                _require(
                    0 < len(series_nodes) <= MAX_SERIES,
                    "Native chart must contain a bounded number of complete data series",
                )
                rows = []
                for ordinal, series in enumerate(series_nodes, 1):
                    scatter = (
                        series.find("c:xVal", NS) is not None
                        or series.find("c:yVal", NS) is not None
                    )
                    category_parent = series.find("c:xVal" if scatter else "c:cat", NS)
                    value_parent = series.find("c:yVal" if scatter else "c:val", NS)
                    _require(
                        category_parent is not None and value_parent is not None,
                        "Literal chart series must preserve complete category/value pairs",
                    )
                    category_lit, categories, category_kind = _literal(
                        category_parent, numeric=scatter, allow_strings=not scatter
                    )
                    value_lit, values, value_kind = _literal(
                        value_parent, numeric=True, allow_strings=False
                    )
                    _require(
                        value_kind == "numLit" and len(categories) == len(values),
                        "Literal chart category/value point counts are inconsistent",
                    )
                    first = _column(ordinal * 2 - 1)
                    second = _column(ordinal * 2)
                    last = len(values) + 1
                    _replace_literal(
                        category_parent,
                        category_lit,
                        kind=category_kind,
                        formula=f"'Chart Data'!${first}$2:${first}${last}",
                    )
                    _replace_literal(
                        value_parent,
                        value_lit,
                        kind=value_kind,
                        formula=f"'Chart Data'!${second}$2:${second}${last}",
                    )
                    rows.append(
                        {
                            "categories": categories,
                            "values": values,
                            "category_kind": category_kind,
                            "name": _series_name(series, ordinal),
                            "scatter": scatter,
                        }
                    )

                suffix = 1
                while (
                    workbook_part := f"{SNAPSHOT_PREFIX}{suffix:03d}.xlsx"
                ) in names or workbook_part in additions:
                    suffix += 1
                additions[workbook_part] = _workbook(rows)
                existing_ids = {
                    item.get("Id") for item in relation_root.findall("rel:Relationship", NS)
                }
                relation_number = 1
                while (relation_id := f"rIdChartSnapshot{relation_number}") in existing_ids:
                    relation_number += 1
                target = posixpath.relpath(
                    workbook_part, start=str(PurePosixPath(chart_part).parent)
                )
                _require(
                    not target.startswith("/") and "://" not in target,
                    "Generated chart workbook relationship must remain local and relative",
                )
                etree.SubElement(
                    relation_root,
                    _q(REL, "Relationship"),
                    Id=relation_id,
                    Type=GATE.WORKBOOK_RELATIONSHIP,
                    Target=target,
                )
                external_data = etree.Element(_q(C, "externalData"))
                external_data.set(_q(R, "id"), relation_id)
                etree.SubElement(external_data, _q(C, "autoUpdate"), val="0")
                following = next(
                    (
                        index
                        for index, child in enumerate(chart_root)
                        if child.tag
                        in {_q(C, "printSettings"), _q(C, "userShapes"), _q(C, "extLst")}
                    ),
                    len(chart_root),
                )
                chart_root.insert(following, external_data)
                modifications[chart_part] = _bytes(chart_root, chart_original)
                if relation_original is None:
                    additions[relation_part] = _bytes(relation_root)
                else:
                    modifications[relation_part] = _bytes(relation_root, relation_original)
                converted.append(
                    {
                        "owner_slide": slide,
                        "chart_part": chart_part,
                        "workbook_part": workbook_part,
                        "series_count": len(rows),
                        "point_count": sum(len(row["values"]) for row in rows),
                    }
                )

        _require(
            converted,
            "No eligible self-contained literal native chart requires snapshot materialization",
        )
        defaults = [
            child
            for child in types.findall("{" + CT + "}Default")
            if child.get("Extension", "").lower() == "xlsx"
        ]
        _require(
            len(defaults) <= 1,
            "Presentation content types contain duplicate workbook extension declarations",
        )
        if defaults:
            _require(
                defaults[0].get("ContentType") == WORKBOOK_MIME,
                "Presentation workbook content type conflicts with the real embedded XLSX format",
            )
        else:
            etree.SubElement(types, _q(CT, "Default"), Extension="xlsx", ContentType=WORKBOOK_MIME)
            modifications["[Content_Types].xml"] = _bytes(types, content_original)

        output_bytes = io.BytesIO()
        with zipfile.ZipFile(output_bytes, "w") as rendered:
            for part in archive.infolist():
                rendered.writestr(
                    part, modifications.get(part.filename, archive.read(part.filename))
                )
            for name, data in additions.items():
                rendered.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
        result_bytes = output_bytes.getvalue()
        _require(
            0 < len(result_bytes) <= MAX_BYTES,
            "Materialized chart snapshot exceeds its bounded presentation size",
        )

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".literal-chart-snapshot-", dir=output_path.parent
    )
    temporary = Path(temporary_name)
    receipt_temporary = None
    output_published = receipt_published = False
    try:
        with os.fdopen(descriptor, "wb") as stream:
            # mkstemp is mode 0600 on POSIX. Windows inherits the private staged
            # workspace ACL and does not expose fchmod before Python 3.13.
            if hasattr(os, "fchmod"):
                os.fchmod(stream.fileno(), 0o600)
            stream.write(result_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        portable = GATE.audit_native_quantitative_charts(
            temporary,
            {int(slide): int(count) for slide, count in discovery["chart_counts"].items()},
            target_application="portable",
        )
        _require(
            portable.get("passed") is True and portable.get("failed_slide_count") == 0,
            "Generated chart-data snapshot failed workbook/cache validation: "
            + "; ".join(
                str(result.get("failure_detail", "chart contract failed"))
                for result in portable.get("results", [])
                if result.get("status") == "failed"
            ),
        )
        _require(
            hashlib.sha256(input_path.read_bytes()).hexdigest() == original_sha,
            "Original staged presentation changed during chart snapshot materialization",
        )
        output_sha = hashlib.sha256(result_bytes).hexdigest()
        payload = {
            "schema_version": "experimental.literal-chart-workbook-snapshot.v1",
            "conversion": "chart_data_snapshot",
            "experimental": True,
            "source_formulas_preserved": False,
            "source_workbook_preserved": False,
            "new_formulas_describe_snapshot_only": True,
            "input_sha256": original_sha,
            "output_sha256": output_sha,
            "output_bytes": len(result_bytes),
            "detected_chart_owner_slides": discovery["chart_owner_slides"],
            "converted_chart_count": len(converted),
            "preserved_existing_workbook_chart_count": len(preserved),
            "converted_charts": converted,
            "preserved_existing_workbook_charts": preserved,
            "source_formula_required_slides": sorted(formula_required),
            "source_workbook_required_slides": sorted(workbook_required),
            "portable_chart_validation_passed": True,
            "portable_validated_owner_slides": portable["expected_quantitative_chart_slides"],
        }
        handle, receipt_name = tempfile.mkstemp(
            prefix=".literal-chart-snapshot-receipt-", dir=receipt_path.parent
        )
        receipt_temporary = Path(receipt_name)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            if hasattr(os, "fchmod"):
                os.fchmod(stream.fileno(), 0o600)
            json.dump(payload, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        _require(
            not output_path.exists() and not receipt_path.exists(),
            "A staged snapshot output or receipt already exists",
        )
        os.link(temporary, output_path)
        output_published = True
        os.link(receipt_temporary, receipt_path)
        receipt_published = True
        return payload
    except GATE.ChartGateError as error:
        raise SnapshotError(
            f"Generated chart-data snapshot failed portable workbook validation: {error}"
        ) from error
    finally:
        # If publishing the second hard link fails, do not leave an apparently
        # finished PPTX without its required provenance receipt. Never remove a
        # file that replaced our output in a concurrent operation.
        if (
            output_published
            and not receipt_published
            and output_path.exists()
            and output_path.samefile(temporary)
        ):
            output_path.unlink()
        temporary.unlink(missing_ok=True)
        if receipt_temporary is not None:
            receipt_temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Exact staged self-contained literal-chart PPTX")
    parser.add_argument("destination", type=Path, help="New private staged PPTX, never overwritten")
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--require-source-formulas-slide", action="append", type=int, default=[])
    parser.add_argument("--require-source-workbook-slide", action="append", type=int, default=[])
    args = parser.parse_args(argv)
    try:
        result = materialize_literal_chart_workbooks(
            args.source,
            args.destination,
            receipt=args.receipt,
            workspace=args.workspace,
            source_formula_required_slides=args.require_source_formulas_slide,
            source_workbook_required_slides=args.require_source_workbook_slide,
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except (SnapshotError, GATE.ChartGateError, OSError, ValueError) as error:
        print(
            json.dumps(
                {"ok": False, "error_category": type(error).__name__, "error": str(error)},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
