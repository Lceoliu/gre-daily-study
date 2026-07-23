#!/usr/bin/env python
"""Restore inline GRE-style blank boxes from the original question screenshots.

The scanned PDFs encode their fill-in blanks as horizontal strokes, which OCR
does not emit as text.  This script combines the coordinate-aware OCR cache
with a narrow horizontal-line detector to inject ``[[BLANK:n]]`` markers into
each Text Completion and Sentence Equivalence stem.  The marker positions are
then carried into the public practice JSON and rendered as inline boxes.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

import cv2  # type: ignore[import-not-found]
import numpy as np  # type: ignore[import-not-found]
from pypdf import PdfReader  # type: ignore[import-not-found]

from build_verbal_question_bank import (  # type: ignore[import-not-found]
    ROMAN_BLANK_RE,
    clean_spatial_lines,
    make_rows,
    visible_content_rows,
)


ROOT = Path(__file__).resolve().parents[1]
QUESTION_BANK_PATH = ROOT / "local-data" / "verbal-question-bank" / "verbal-question-bank.json"
CACHE_DIR = ROOT / "tmp" / "verbal-ocr-lines"
PDF_DIR = ROOT / "public" / "pdfs"
OUTPUT_PATH = ROOT / "local-data" / "cloze-layouts" / "cloze-layouts.json"
AUDIT_PATH = ROOT / "local-data" / "cloze-layouts" / "cloze-layout-audit.json"

MARKER_RE = re.compile(r"\[\[BLANK:(\d+)\]\]")
TOKEN_RE = re.compile(r"\([ivx]{1,4}\)|[A-Za-z0-9]+", re.IGNORECASE)

# Exact repairs verified against the local scanned GRE screenshots.  These four
# pages either use a faint blank stroke that the image detector cannot recover
# or have OCR fragments reordered around the blank.  Keeping the correction
# here makes the public result reproducible and auditable rather than hiding a
# guess in the frontend.
MANUAL_LAYOUT_OVERRIDES: dict[str, dict[str, Any]] = {
    "practice-05:S3:Q3": {
        "question_text": (
            "Whatever the level of the museum's past (i) American art, it pales beside its current (ii). "
            "Since opening its renovated and expanded building, the museum has relegated American paintings to "
            "hard-to-find corners of the museum. It is as if American art is (iii) the overwhelmingly European "
            "narrative that dominates the permanent collection galleries."
        ),
        "cloze_text": (
            "Whatever the level of the museum's past (i) [[BLANK:1]] American art, it pales beside its current "
            "(ii) [[BLANK:2]]. Since opening its renovated and expanded building, the museum has relegated American "
            "paintings to hard-to-find corners of the museum. It is as if American art is (iii) [[BLANK:3]] the "
            "overwhelmingly European narrative that dominates the permanent collection galleries."
        ),
    },
    "practice-12:S3:Q9": {
        "question_text": (
            "It can be a daunting task to plunge into the disparate and extensive data sets on the carnivores and "
            "meaningful patterns from their extraordinary morphological, behavioral, and ecological diversity."
        ),
        "cloze_text": (
            "It can be a daunting task to plunge into the disparate and extensive data sets on the carnivores and "
            "[[BLANK:1]] meaningful patterns from their extraordinary morphological, behavioral, and ecological diversity."
        ),
        "options": [
            {"label": "A", "text": "distill"},
            {"label": "B", "text": "conjure"},
            {"label": "C", "text": "distinguish"},
            {"label": "D", "text": "extract"},
            {"label": "E", "text": "conceal"},
            {"label": "F", "text": "hide"},
        ],
    },
    "practice-16:S2:Q9": {
        "question_text": (
            "Dogs' intake of olfactory information is less than that of humans because dogs exhale through the side "
            "slits of their nostrils, keeping a continuous flow of inhaled air in their snouts for smelling."
        ),
        "cloze_text": (
            "Dogs' intake of olfactory information is less [[BLANK:1]] than that of humans because dogs exhale through "
            "the side slits of their nostrils, keeping a continuous flow of inhaled air in their snouts for smelling."
        ),
    },
    "practice-17:S2:Q9": {
        "question_text": (
            "Dogs' intake of olfactory information is less than that of humans because dogs exhale through the side "
            "slits of their nostrils, keeping a continuous flow of inhaled air in their snouts for smelling."
        ),
        "cloze_text": (
            "Dogs' intake of olfactory information is less [[BLANK:1]] than that of humans because dogs exhale through "
            "the side slits of their nostrils, keeping a continuous flow of inhaled air in their snouts for smelling."
        ),
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--question-bank", type=Path, default=QUESTION_BANK_PATH)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--pdf-dir", type=Path, default=PDF_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--audit", type=Path, default=AUDIT_PATH)
    parser.add_argument("--allow-unresolved", action="store_true", help="Write an audit instead of failing when a marker cannot be placed.")
    return parser.parse_args()


def expected_blank_count(record: dict[str, Any]) -> int:
    raw = record.get("response_format", {}).get("blank_count")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 0
    return value or 1


def roman(index: int) -> str:
    return "i" * index


def stem_layout(record: dict[str, Any], spatial: dict[str, Any]) -> tuple[list[dict[str, Any]], float | None]:
    lines = clean_spatial_lines(spatial.get("lines", []))
    rows = make_rows(lines)
    content_rows, _ = visible_content_rows(rows, int(spatial["image_height"]))
    blank_count = expected_blank_count(record)

    if record["question_type"] == "text_completion" and blank_count > 1:
        headers = [
            row
            for row in rows
            if spatial["image_height"] * 0.28 < row["y0"] < spatial["image_height"] * 0.82
            and ROMAN_BLANK_RE.search(row["text"])
        ]
        if headers:
            header_y = min(row["y0"] for row in headers)
            return [row for row in content_rows if row["y1"] < header_y], header_y - 14

    expected_options = int(record.get("response_format", {}).get("expected_option_count", 0))
    if expected_options and len(content_rows) >= expected_options:
        option_rows = content_rows[-expected_options:]
        return content_rows[:-expected_options], min(row["y0"] for row in option_rows) - 14
    return content_rows, None


def page_image(reader: PdfReader, page_number: int) -> np.ndarray:
    images = list(reader.pages[page_number - 1].images)
    if not images:
        raise RuntimeError(f"PDF page {page_number} has no embedded screenshot")
    source = max(images, key=lambda image: len(image.data))
    image = cv2.imdecode(np.frombuffer(source.data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not decode page {page_number} screenshot")
    return image


def merge_rectangles(rectangles: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Collapse duplicate contour fragments from the same black underline."""

    merged: list[tuple[int, int, int, int]] = []
    for x, y, width, height in sorted(rectangles, key=lambda item: (item[1], item[0])):
        for index, (old_x, old_y, old_width, old_height) in enumerate(merged):
            same_baseline = abs((old_y + old_height / 2) - (y + height / 2)) <= 5
            overlaps = x <= old_x + old_width + 8 and old_x <= x + width + 8
            if same_baseline and overlaps:
                left = min(x, old_x)
                right = max(x + width, old_x + old_width)
                top = min(y, old_y)
                bottom = max(y + height, old_y + old_height)
                merged[index] = (left, top, right - left, bottom - top)
                break
        else:
            merged.append((x, y, width, height))
    return merged


def detect_underlines(
    image: np.ndarray, rows: list[dict[str, Any]], stem_bottom: float | None
) -> list[tuple[int, int, int, int]]:
    if not rows:
        return []
    y_min = max(0, int(min(row["y0"] for row in rows) - 18))
    inferred_bottom = max(row["y1"] for row in rows) + 72
    y_max = min(image.shape[0], int(stem_bottom if stem_bottom is not None else inferred_bottom))
    if y_max <= y_min:
        return []

    crop = image[y_min:y_max]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # Some photographed test screens render the blank stroke in medium gray,
    # while normal text remains darker.  A slightly wider threshold keeps the
    # stroke; the horizontal morphology and tight stem crop reject text noise.
    dark = cv2.inRange(gray, 0, 185)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (42, 1))
    horizontal = cv2.morphologyEx(dark, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(horizontal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        # GRE blank strokes are long and thin.  The stem crop excludes option
        # tables, while this width cap filters page borders and panel rules.
        if 48 <= width <= 360 and height <= 10:
            candidates.append((x, y + y_min, width, height))
    return merge_rectangles(candidates)


def match_normalized(text: str) -> tuple[str, list[int]]:
    normalized: list[str] = []
    positions: list[int] = []
    for index, character in enumerate(unicodedata.normalize("NFKC", text)):
        character = {"’": "'", "‘": "'", "–": "-", "—": "-"}.get(character, character)
        if character.isalnum() or character in "()":
            normalized.append(character.lower())
            positions.append(index)
    return "".join(normalized), positions


def fragment_anchor(text: str, direction: str) -> str:
    tokens = TOKEN_RE.findall(text)
    if not tokens:
        return ""
    selected = tokens[-7:] if direction == "before" else tokens[:7]
    return "".join(match_normalized("".join(selected))[0])


def find_anchor_offset(question_text: str, anchor: str, cursor: int, placement: str) -> int | None:
    normalized, positions = match_normalized(question_text)
    if not anchor or not normalized:
        return None
    start_normalized = next((index for index, position in enumerate(positions) if position >= cursor), len(positions))
    found = normalized.find(anchor, start_normalized)
    if found < 0:
        return None
    if placement == "after":
        return positions[found + len(anchor) - 1] + 1
    return positions[found]


def marker_position_from_geometry(
    underline: tuple[int, int, int, int], rows: list[dict[str, Any]]
) -> tuple[str, str, int] | None:
    """Return a text fragment plus whether its marker belongs before/after it."""

    x, y, width, height = underline
    center_y = y + height / 2
    nearby = [row for row in rows if row["y0"] - 22 <= center_y <= row["y1"] + 22]
    if nearby:
        row = min(nearby, key=lambda item: abs(item["cy"] - center_y))
        before = [item for item in row["items"] if item["x1"] <= x + 12]
        after = [item for item in row["items"] if item["x0"] >= x + width - 12]
        if before and after:
            return max(before, key=lambda item: item["x1"])["text"], "after", 3
        if before:
            return max(before, key=lambda item: item["x1"])["text"], "after", 2
        if after:
            return min(after, key=lambda item: item["x0"])["text"], "before", 2

    # A one-blank question can wrap immediately before the blank, leaving the
    # underline on a line with no OCR text at all.  Attach it after the last
    # preceding visible stem fragment in that common official layout.
    preceding_rows = [row for row in rows if row["cy"] < center_y]
    if preceding_rows:
        prior = max(preceding_rows, key=lambda item: item["cy"])
        if prior["items"]:
            return max(prior["items"], key=lambda item: item["x1"])["text"], "after", 1
    following_rows = [row for row in rows if row["cy"] > center_y]
    if following_rows:
        following = min(following_rows, key=lambda item: item["cy"])
        if following["items"]:
            return min(following["items"], key=lambda item: item["x0"])["text"], "before", 1
    return None


def normalize_blank_labels(text: str) -> str:
    """Repair OCR punctuation around the explicit GRE ``(i)`` labels only."""

    return re.sub(r"\(\s*(i{1,3})(?!i)\s*[)._\]]+", r"(\1)", text, flags=re.IGNORECASE)


def inject_markers(record: dict[str, Any], rows: list[dict[str, Any]], underlines: list[tuple[int, int, int, int]]) -> tuple[str | None, list[str]]:
    expected = expected_blank_count(record)
    question_text = str(record["question_text"])
    output = normalize_blank_labels(question_text)
    cursor = 0
    reasons: list[str] = []
    ordered_underlines = sorted(underlines, key=lambda item: (item[1], item[0]))

    for index in range(1, expected + 1):
        marker = f"[[BLANK:{index}]]"
        label = f"({roman(index)})"
        # GRE multi-blank questions explicitly label every slot.  Preserving
        # that label and placing a box immediately after it is more reliable
        # than inferring a position from an OCR fragment split.
        if expected > 1:
            label_anchor = match_normalized(label)[0]
            offset = find_anchor_offset(output, label_anchor, cursor, "after")
            if offset is not None:
                output = f"{output[:offset]} {marker}{output[offset:]}"
                cursor = offset + len(marker) + 1
                continue

        candidates: list[tuple[int, int, str, int]] = []
        for underline_index, underline in enumerate(ordered_underlines):
            geometry_anchor = marker_position_from_geometry(underline, rows)
            if not geometry_anchor:
                continue
            fragment, placement, score = geometry_anchor
            anchor = fragment_anchor(fragment, "before" if placement == "after" else "after")
            offset = find_anchor_offset(output, anchor, cursor, placement)
            if offset is not None:
                candidates.append((score, -underline_index, placement, offset))
        if candidates:
            _, _, placement, offset = max(candidates)
            output = f"{output[:offset]} {marker} {output[offset:]}"
            cursor = offset + len(marker) + 2
            continue

        reasons.append(f"blank_{index}_unresolved")

    # OCR frequently turns the line following a multi-blank label into a
    # period.  The source image has no such period before the blank box.
    output = re.sub(r"(\([ivx]{1,4}\))\s*(\[\[BLANK:\d+\]\])\s*\.", r"\1 \2", output, flags=re.IGNORECASE)
    if len(MARKER_RE.findall(output)) != expected:
        reasons.append("marker_count_mismatch")
    return (output if not reasons else None), reasons


def main() -> None:
    args = parse_args()
    question_bank = json.loads(args.question_bank.read_text(encoding="utf-8"))
    records = [
        record
        for record in question_bank["records"]
        if record["question_type"] in {"text_completion", "sentence_equivalence"}
    ]
    cache_by_file = {
        path.stem: {entry["id"]: entry for entry in json.loads(path.read_text(encoding="utf-8"))["records"]}
        for path in args.cache_dir.glob("practice-*.json")
    }
    readers: dict[str, PdfReader] = {}
    output_records: list[dict[str, Any]] = []
    audit_records: list[dict[str, Any]] = []

    for record in records:
        pdf_file = record["source"]["pdf_file"]
        cache = cache_by_file.get(Path(pdf_file).stem, {})
        spatial = cache.get(record["id"])
        if not spatial:
            audit_records.append({"id": record["id"], "status": "unresolved", "reasons": ["missing_ocr_cache"]})
            continue
        rows, stem_bottom = stem_layout(record, spatial)
        reader = readers.setdefault(pdf_file, PdfReader(args.pdf_dir / pdf_file))
        image = page_image(reader, int(record["source"]["page"]))
        underlines = detect_underlines(image, rows, stem_bottom)
        override = MANUAL_LAYOUT_OVERRIDES.get(record["id"])
        if override:
            cloze_text = str(override["cloze_text"])
            reasons: list[str] = []
        else:
            cloze_text, reasons = inject_markers(record, rows, underlines)
        audit = {
            "id": record["id"],
            "expected_blank_count": expected_blank_count(record),
            "detected_underlines": len(underlines),
            "underlines": [{"x": x, "y": y, "width": width, "height": height} for x, y, width, height in underlines],
            "status": "resolved" if cloze_text else "unresolved",
            "reasons": reasons,
        }
        if override:
            audit["strategy"] = "manual_source_pdf"
        audit_records.append(audit)
        if cloze_text:
            layout_record: dict[str, Any] = {
                "id": record["id"],
                "cloze_text": cloze_text,
                "blank_count": expected_blank_count(record),
            }
            if override and override.get("question_text"):
                layout_record["question_text"] = override["question_text"]
            if override and override.get("options"):
                layout_record["options"] = override["options"]
            output_records.append(layout_record)

    output_records.sort(key=lambda item: item["id"])
    unresolved = [record for record in audit_records if record["status"] != "resolved"]
    payload = {"schema_version": 1, "record_count": len(output_records), "records": output_records}
    audit_payload = {
        "schema_version": 1,
        "expected_record_count": len(records),
        "resolved_record_count": len(output_records),
        "unresolved_record_count": len(unresolved),
        "underlines_detected_distribution": dict(sorted(Counter(item["detected_underlines"] for item in audit_records if "detected_underlines" in item).items())),
        "records": audit_records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    args.audit.write_text(json.dumps(audit_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Cloze layouts: {len(output_records)}/{len(records)} resolved; "
        f"{len(unresolved)} unresolved."
    )
    if unresolved and not args.allow_unresolved:
        raise SystemExit("Cloze layout generation failed; inspect the audit before publishing.")


if __name__ == "__main__":
    main()
