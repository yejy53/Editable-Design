#!/usr/bin/env python3
"""Reject unintended empty native main-chart titles without modifying the deck.

Logical slide relationships are authoritative. Existing rich/link-based titles
and axis titles are preserved; source strings and chart values are never emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

# The bundled Python enables safe-path mode, so sibling modules need an explicit path.
SCRIPT_DIR = str(Path(__file__).resolve().parent)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from native_quantitative_chart_gate import (
    CHART_RELATIONSHIP,
    MAX_PACKAGE_BYTES,
    MAX_PACKAGE_PARTS,
    NS,
    ChartGateError,
    _relationships,
    _safe_xml,
    logical_presentation_slides,
)

SCHEMA = "presentation-native-chart-titles.v1"


def audit_native_chart_titles(path: Path) -> dict:
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_PACKAGE_BYTES:
        raise ValueError("A bounded regular presentation file is required")
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    checks, findings = [], []
    with zipfile.ZipFile(path) as package:
        names = package.namelist()
        if (
            len(names) > MAX_PACKAGE_PARTS
            or len(names) != len(set(names))
            or sum(item.file_size for item in package.infolist()) > MAX_PACKAGE_BYTES
        ):
            raise ValueError("Presentation has duplicate or excessive package parts")
        slides = logical_presentation_slides(package)
        for slide_number, slide_part in slides.items():
            slide = _safe_xml(package, slide_part)
            relationships = _relationships(package, slide_part)
            for index, chart_reference in enumerate(slide.findall(".//c:chart", NS), 1):
                identifier = chart_reference.get("{" + NS["r"] + "}id")
                relation = relationships.get(identifier)
                if (
                    not relation
                    or relation["mode"] != "Internal"
                    or relation["type"] != CHART_RELATIONSHIP
                ):
                    raise ValueError("A native chart has no genuine internal relationship")
                chart_space = _safe_xml(package, relation["target"])
                if chart_space.tag != "{" + NS["c"] + "}chartSpace":
                    raise ValueError("A native chart relationship does not resolve to a chart")
                chart = chart_space.find("c:chart", NS)
                if chart is None:
                    raise ValueError("A native chart has no chart element")
                titles = chart.findall("c:title", NS)
                if len(titles) > 1:
                    raise ValueError("A native chart has duplicate main-title elements")
                status = "absent"
                if titles:
                    title = titles[0]
                    fragments = [entry.text or "" for entry in title.findall(".//a:t", NS)]
                    fragments += [
                        entry.text or ""
                        for entry in title.findall("c:tx/c:strRef/c:strCache/c:pt/c:v", NS)
                    ]
                    literal = " ".join(fragments).strip()
                    formula = title.find("c:tx/c:strRef/c:f", NS)
                    deleted = chart.find("c:autoTitleDeleted", NS)
                    suppressed = deleted is not None and deleted.get("val") in {"1", "true"}
                    if literal:
                        status = "present"
                        if " ".join(literal.casefold().split()) == "chart title" and not suppressed:
                            status = "default_placeholder"
                    elif formula is not None and (formula.text or "").strip():
                        # A genuine dynamic reference can be legitimate without a
                        # cached value. Do not remove or claim to have resolved it.
                        status = "linked_title_unresolved"
                    elif suppressed:
                        status = "explicitly_suppressed"
                    else:
                        status = "empty_title"
                check = {"slide": slide_number, "chart": index, "status": status}
                checks.append(check)
                if status in {"empty_title", "default_placeholder"}:
                    findings.append(
                        {"slide": slide_number, "chart": index, "code": "native_chart_" + status}
                    )
    if hashlib.sha256(path.read_bytes()).hexdigest() != before:
        raise ValueError("Presentation changed during chart-title inspection")
    return {
        "schema_version": SCHEMA,
        "passed": not findings,
        "presentation_sha256": before,
        "slide_count": len(slides),
        "native_chart_count": len(checks),
        "checks": checks,
        "unresolved_linked_title_count": sum(
            c["status"] == "linked_title_unresolved" for c in checks
        ),
        "finding_count": len(findings),
        "findings": findings,
        "native_powerpoint_verified": False,
        "source_text_emitted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("presentation", type=Path)
    args = parser.parse_args()
    try:
        report = audit_native_chart_titles(args.presentation)
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
        return 0 if report["passed"] else 1
    except (OSError, ValueError, ChartGateError, zipfile.BadZipFile):
        print(
            json.dumps(
                {
                    "schema_version": SCHEMA,
                    "passed": False,
                    "error": "Chart-title inspection could not validate the package",
                }
            )
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
