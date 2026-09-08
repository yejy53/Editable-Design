#!/usr/bin/env python3
"""Review displayed table totals; enforce only explicitly declared arithmetic contracts.

Auto-discovered totals are diagnostics. Comparisons allow for displayed rounding
and do not establish equality of the underlying source values. Unsupported number
formats are reported as skipped, never silently treated as zero.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, Iterable, Mapping
from xml.etree import ElementTree

# The bundled Python enables safe-path mode, so sibling modules need an explicit path.
SCRIPT_DIR = str(Path(__file__).resolve().parent)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from native_quantitative_chart_gate import (
    MAX_PACKAGE_BYTES,
    MAX_PACKAGE_PARTS,
    NS,
    _safe_xml,
    logical_presentation_slides,
)

SCHEMA_VERSION = "presentation-native-table-arithmetic.v1"
MAX_TABLES_PER_SLIDE = 100
MAX_TABLE_ROWS = 2_000
MAX_TABLE_COLUMNS = 100
MAX_CELL_CHARACTERS = 2_048
MAX_CONTRACTS = 200
_TOTAL = re.compile(r"\btotal\b", re.IGNORECASE)
_SUBTOTAL = re.compile(r"\bsub[\s-]?total\b", re.IGNORECASE)
_SEMANTIC_EXCLUSION = re.compile(
    r"\b(?:percent(?:age)?|ratio|rate|yield|ytd|qtd|mtd|net|margin|growth|"
    r"weighted|average|mean|median|multiple|variance|delta|index|wacc|irr|share|"
    r"stock|flow|cashflow|balance|opening|closing|beginning|ending)\b|%|‰|/",
    re.IGNORECASE,
)
_NON_ADDITIVE_HEADER = re.compile(
    r"\b(?:unit[\s-]+(?:price|cost|rate|value)|price|per[\s-]+unit|per[\s-]+share)\b",
    re.IGNORECASE,
)
_NUMBER = re.compile(
    r"^\s*(?P<open>\()?\s*(?P<sign>[+\-−])?\s*"
    r"(?P<currency>[$€£¥]|USD|EUR|GBP|JPY)?\s*"
    r"(?P<number>(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,12})?)"
    r"\s*(?P<magnitude>[kKmMbB])?\s*"
    r"(?P<suffix_currency>USD|EUR|GBP|JPY)?\s*(?P<close>\))?\s*$"
)


class ArithmeticGateError(ValueError):
    """Reject malformed packages/contracts without leaking document text."""


@dataclass(frozen=True)
class _Amount:
    value: Decimal
    places: int
    currency: str
    magnitude: str


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ArithmeticGateError(message)


def _local(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _visible_tables(root: ElementTree.Element) -> list[ElementTree.Element]:
    """Traverse only visible group/frame descendants; never include pasted images."""
    containers = {
        "sp": "nvSpPr",
        "cxnSp": "nvCxnSpPr",
        "grpSp": "nvGrpSpPr",
        "graphicFrame": "nvGraphicFramePr",
        "pic": "nvPicPr",
    }
    tables: list[ElementTree.Element] = []
    stack: list[tuple[ElementTree.Element, bool]] = [(root, False)]
    while stack:
        element, within_frame = stack.pop()
        kind = _local(element)
        container = containers.get(kind)
        properties = element.find(f"p:{container}/p:cNvPr", NS) if container else None
        if properties is not None and properties.get("hidden", "0").casefold() in {"1", "true"}:
            continue
        within_frame = within_frame or kind == "graphicFrame"
        if element.tag == "{" + NS["a"] + "}tbl" and within_frame:
            tables.append(element)
            _require(
                len(tables) <= MAX_TABLES_PER_SLIDE,
                "A slide exceeds its bounded native-table count",
            )
            continue
        stack.extend((child, within_frame) for child in reversed(list(element)))
    return tables


def _rows(table: ElementTree.Element) -> tuple[list[list[str]], bool, bool]:
    rows = table.findall("a:tr", NS)
    _require(len(rows) <= MAX_TABLE_ROWS, "A native table exceeds its bounded row count")
    properties = table.find("a:tblPr", NS)
    first_row_header = properties is not None and properties.get("firstRow", "0").casefold() in {
        "1",
        "true",
    }
    result: list[list[str]] = []
    merged = False
    for row in rows:
        cells = row.findall("a:tc", NS)
        _require(len(cells) <= MAX_TABLE_COLUMNS, "A native table exceeds its bounded column count")
        values = []
        for cell in cells:
            if any(
                cell.get(key) not in {None, "0", "1" if key in {"gridSpan", "rowSpan"} else None}
                for key in ("gridSpan", "rowSpan", "hMerge", "vMerge")
            ):
                merged = True
            text = " ".join((part.text or "") for part in cell.findall(".//a:t", NS)).strip()
            _require(
                len(text) <= MAX_CELL_CHARACTERS,
                "A native-table cell exceeds its bounded text size",
            )
            values.append(text)
        result.append(values)
    return result, merged, first_row_header


def _amount(value: str) -> _Amount | None:
    if not isinstance(value, str) or len(value) > 96:
        return None
    match = _NUMBER.fullmatch(value)
    if not match or bool(match.group("open")) != bool(match.group("close")):
        return None
    if match.group("open") and match.group("sign"):
        return None
    prefix, suffix = match.group("currency") or "", match.group("suffix_currency") or ""
    if prefix and suffix and prefix != suffix:
        return None
    raw = match.group("number")
    try:
        number = Decimal(raw.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or len(number.as_tuple().digits) > 40:
        return None
    if match.group("open") or match.group("sign") in {"-", "−"}:
        number = number.copy_negate()
    return _Amount(
        number,
        len(raw.partition(".")[2]),
        (prefix or suffix).upper(),
        (match.group("magnitude") or "").casefold(),
    )


def _consistent_units(amounts: list[_Amount]) -> bool:
    currencies = {item.currency for item in amounts if item.currency}
    magnitudes = {item.magnitude for item in amounts}
    return len(currencies) <= 1 and len(magnitudes) <= 1


def _rounding_tolerance(amounts: list[_Amount]) -> Decimal:
    return sum((Decimal(1).scaleb(-item.places) / 2 for item in amounts), Decimal(0))


def _table_reason(reason: str, slide: int, table: int) -> dict[str, Any]:
    return {"slide": slide, "table": table, "reason": reason}


def _auto_plan(
    rows: list[list[str]], merged: bool, first_row_header: bool
) -> tuple[dict[str, Any] | None, str | None]:
    if merged:
        return None, "merged_cell_geometry"
    if len(rows) < 3:
        return None, "insufficient_rows"
    numeric_rows = [index for index, row in enumerate(rows) if any(_amount(value) for value in row)]
    if not numeric_rows:
        return None, "no_numeric_amounts"
    total_row = numeric_rows[-1]
    last = rows[total_row]
    labels = [
        (index, value) for index, value in enumerate(last) if value and _amount(value) is None
    ]
    if len(labels) != 1 or not _TOTAL.search(labels[0][1]) or _SUBTOTAL.search(labels[0][1]):
        return None, "no_unambiguous_bottom_total"
    label_column, total_label = labels[0]
    if _SEMANTIC_EXCLUSION.search(total_label):
        return None, "ambiguous_financial_semantics"
    candidates = [
        index
        for index, value in enumerate(last)
        if index != label_column and _amount(value) is not None
    ]
    if not candidates:
        return None, "no_total_amount_column"
    total_words = []
    for _index, row in enumerate(rows[:total_row]):
        label = row[label_column] if label_column < len(row) else ""
        if _SUBTOTAL.search(label) or _TOTAL.search(label):
            return None, "intermediate_subtotal_or_total"
        if label:
            total_words.append(label)
    if _SEMANTIC_EXCLUSION.search(" ".join(total_words)):
        return None, "ambiguous_financial_semantics"
    return {
        "label_column": label_column,
        "total_row": total_row,
        "value_columns": candidates,
        "first_row_header": first_row_header,
    }, None


def _column_components(
    rows: list[list[str]], plan: Mapping[str, Any], column: int, explicit: bool
) -> tuple[list[int] | None, str | None]:
    total_row = int(plan["total_row"])
    if explicit:
        indices = list(plan["component_rows"])
        if any(
            column >= len(rows[index]) or _amount(rows[index][column]) is None for index in indices
        ):
            return None, "missing_or_nonnumeric_component"
        return indices, None
    started = False
    indices: list[int] = []
    label_column = int(plan["label_column"])
    declared_header = bool(plan.get("first_row_header"))
    for index, row in enumerate(rows[:total_row]):
        value = row[column] if column < len(row) else ""
        parsed = _amount(value)
        if index == 0 and declared_header:
            if _SEMANTIC_EXCLUSION.search(value) or _NON_ADDITIVE_HEADER.search(value):
                return None, "non_additive_column_header"
            continue
        if not started and parsed is None and value:
            if _SEMANTIC_EXCLUSION.search(value) or _NON_ADDITIVE_HEADER.search(value):
                return None, "non_additive_column_header"
        if index == 0 and not declared_header and parsed is not None:
            label = row[label_column] if label_column < len(row) else ""
            if label and re.fullmatch(r"(?:19|20)[0-9]{2}", value.strip()):
                return None, "ambiguous_numeric_column_header"
        if parsed is not None:
            label = row[label_column] if label_column < len(row) else ""
            if not label or re.fullmatch(r"(?:19|20)[0-9]{2}", label.strip()):
                return None, "ambiguous_component_label"
            indices.append(index)
            started = True
        elif started and any(value.strip() for value in row):
            return None, "missing_or_nonnumeric_component"
    if len(indices) < 2:
        return None, "insufficient_additive_components"
    return indices, None


def _check_column(
    rows: list[list[str]],
    plan: Mapping[str, Any],
    slide: int,
    table: int,
    column: int,
    *,
    explicit: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    total_row = int(plan["total_row"])
    if column >= len(rows[total_row]):
        return None, "missing_total_amount"
    total = _amount(rows[total_row][column])
    if total is None:
        return None, "missing_total_amount"
    components, reason = _column_components(rows, plan, column, explicit)
    if reason:
        return None, reason
    assert components is not None
    parsed = [_amount(rows[index][column]) for index in components]
    if any(value is None for value in parsed):
        return None, "missing_or_nonnumeric_component"
    amounts: list[_Amount] = [value for value in parsed if value is not None]
    if not _consistent_units([*amounts, total]):
        return None, "mixed_amount_units"
    with localcontext() as arithmetic:
        arithmetic.prec = max(
            64,
            max(len(value.value.as_tuple().digits) for value in [*amounts, total])
            + max(value.places for value in [*amounts, total])
            + len(str(len(amounts)))
            + 8,
        )
        difference = abs(sum((value.value for value in amounts), Decimal(0)) - total.value)
        tolerance = _rounding_tolerance([*amounts, total])
    return {
        "slide": slide,
        "table": table,
        "column": column,
        "component_count": len(amounts),
        "rounding_places": total.places,
        "explicit_contract": explicit,
        "comparison": "displayed_values_with_rounding_tolerance",
        "passed": difference <= tolerance,
    }, None


def _normalize_contracts(contracts: Iterable[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    if contracts is None:
        return []
    _require(
        not isinstance(contracts, (str, bytes, Mapping)),
        "Arithmetic contracts must be a bounded list of objects",
    )
    result = []
    for contract in contracts:
        _require(
            len(result) < MAX_CONTRACTS and isinstance(contract, Mapping),
            "Arithmetic contracts must contain bounded objects",
        )
        keys = {"slide", "table", "label_column", "total_row", "value_columns", "component_rows"}
        _require(
            set(contract) == keys,
            "Arithmetic contracts must declare exactly the supported coordinates",
        )
        for field in ("slide", "table", "label_column", "total_row"):
            _require(
                isinstance(contract[field], int)
                and not isinstance(contract[field], bool)
                and contract[field] >= (1 if field in {"slide", "table"} else 0),
                "Arithmetic contracts contain an invalid row, table, or slide index",
            )
        normalized = dict(contract)
        for field, minimum in (("value_columns", 1), ("component_rows", 2)):
            values = contract[field]
            _require(
                isinstance(values, list)
                and minimum <= len(values) <= MAX_TABLE_ROWS
                and all(
                    isinstance(value, int) and not isinstance(value, bool) and value >= 0
                    for value in values
                )
                and len(set(values)) == len(values),
                "Arithmetic contracts contain repeated or invalid row/column coordinates",
            )
            normalized[field] = list(values)
        _require(
            all(index < contract["total_row"] for index in contract["component_rows"]),
            "Arithmetic-contract component rows must precede the total",
        )
        _require(
            contract["label_column"] not in contract["value_columns"],
            "Arithmetic-contract labels and amount columns must be distinct",
        )
        result.append(normalized)
    return result


def audit_native_table_arithmetic(
    presentation: str | Path, *, contracts: Iterable[Mapping[str, Any]] | None = None
) -> dict[str, Any]:
    """Review auto-discovered totals and enforce caller-supplied contracts."""
    selected = Path(presentation)
    _require(
        selected.is_file()
        and not selected.is_symlink()
        and 0 < selected.stat().st_size <= MAX_PACKAGE_BYTES,
        "Presentation must be a bounded regular PowerPoint package",
    )
    requested = _normalize_contracts(contracts)
    checks: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen_contracts: set[int] = set()
    native_count = 0
    eligible_count = 0
    try:
        with zipfile.ZipFile(selected) as package:
            names = package.namelist()
            _require(
                0 < len(names) <= MAX_PACKAGE_PARTS and len(names) == len(set(names)),
                "Presentation contains duplicate or excessive package parts",
            )
            _require(
                sum(item.file_size for item in package.infolist()) <= MAX_PACKAGE_BYTES,
                "Presentation exceeds its bounded uncompressed package size",
            )
            _require(package.testzip() is None, "Presentation contains a corrupt package part")
            slides = logical_presentation_slides(package)
            for slide, part in slides.items():
                tables = _visible_tables(_safe_xml(package, part))
                native_count += len(tables)
                for index, table in enumerate(tables, 1):
                    rows, merged, first_row_header = _rows(table)
                    plan, reason = _auto_plan(rows, merged, first_row_header)
                    auto_checked = 0
                    if plan is not None:
                        for column in plan["value_columns"]:
                            result, column_reason = _check_column(
                                rows,
                                plan,
                                slide,
                                index,
                                column,
                                explicit=False,
                            )
                            if result is None:
                                if auto_checked == 0:
                                    reason = column_reason
                                continue
                            checks.append(result)
                            auto_checked += 1
                        if auto_checked:
                            eligible_count += 1
                    if auto_checked == 0:
                        skipped.append(
                            _table_reason(reason or "no_unambiguous_amount_column", slide, index)
                        )
                    for position, contract in enumerate(requested):
                        if contract["slide"] != slide or contract["table"] != index:
                            continue
                        seen_contracts.add(position)
                        _require(
                            contract["total_row"] < len(rows)
                            and all(row < len(rows) for row in contract["component_rows"]),
                            "Arithmetic contract references a missing native-table row",
                        )
                        for column in contract["value_columns"]:
                            result, contract_reason = _check_column(
                                rows,
                                contract,
                                slide,
                                index,
                                column,
                                explicit=True,
                            )
                            _require(
                                result is not None,
                                "Arithmetic contract cannot resolve a nonnumeric or inconsistent amount column",
                            )
                            assert result is not None
                            checks.append(result)
            _require(
                len(seen_contracts) == len(requested),
                "Arithmetic contract references an absent or hidden native table",
            )
    except zipfile.BadZipFile as exc:
        raise ArithmeticGateError("Presentation is not a valid Office package") from exc
    for check in checks:
        if not check["passed"]:
            target = findings if check["explicit_contract"] else warnings
            target.append(
                {
                    "kind": "native_table_total_mismatch",
                    "slide": check["slide"],
                    "table": check["table"],
                    "column": check["column"],
                    "component_count": check["component_count"],
                    "explicit_contract": check["explicit_contract"],
                }
            )
    return {
        "schema_version": SCHEMA_VERSION,
        "passed": not findings,
        "slide_count": len(slides),
        "native_table_count": native_count,
        "eligible_table_count": eligible_count,
        "checked_column_count": len(checks),
        "checks": checks,
        "skipped_tables": skipped,
        "finding_count": len(findings),
        "findings": findings,
        "warning_count": len(warnings),
        "warnings": warnings,
        "claim_boundary": "Displayed-value arithmetic with rounding tolerance; not source-data verification.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit clearly additive native PowerPoint table totals"
    )
    parser.add_argument("presentation", type=Path)
    parser.add_argument("--contract-json", action="append", default=[])
    parser.add_argument("--fail-on-findings", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        contracts = [json.loads(value) for value in arguments.contract_json]
        result = audit_native_table_arithmetic(arguments.presentation, contracts=contracts)
    except (ArithmeticGateError, ValueError, OSError, RuntimeError) as exc:
        print(
            json.dumps(
                {
                    "schema_version": SCHEMA_VERSION,
                    "passed": False,
                    "error": "native_table_arithmetic_audit_failed",
                    "error_type": type(exc).__name__,
                },
                sort_keys=True,
            )
        )
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
