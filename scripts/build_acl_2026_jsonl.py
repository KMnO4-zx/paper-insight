#!/usr/bin/env python3
"""Build import-ready ACL 2026 JSONL from ACL Anthology metadata."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import requests


REPO_ROOT = Path(__file__).resolve().parent.parent
ACL_EVENT_URL = "https://aclanthology.org/events/acl-2026/"
ACL_LONG_BIB_URL = "https://aclanthology.org/volumes/2026.acl-long.bib"
CONFERENCE_ID = "acl_2026"
CONFERENCE_VENUE = "ACL 2026 Long"
PRIMARY_AREA = "Natural Language Processing"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "crawled_data" / CONFERENCE_ID / "long_papers.jsonl"
USER_AGENT = "paper-online/0.1 (ACL 2026 metadata importer)"


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return clean_text("".join(self.parts))


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def strip_html(fragment: str) -> str:
    parser = TextExtractor()
    parser.feed(fragment)
    return parser.text()


def fetch_text(url: str) -> str:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    response.raise_for_status()
    return response.text


def extract_acl_long_section(html_text: str) -> str:
    start = html_text.find("<div id=2026acl-long>")
    if start < 0:
        raise ValueError("ACL 2026 long section not found")
    end = html_text.find("<div id=2026acl-short>", start)
    if end < 0:
        raise ValueError("ACL 2026 short section boundary not found")
    return html_text[start:end]


def split_bibtex_entries(bib_text: str) -> list[str]:
    return ["@" + entry for entry in re.split(r"(?m)^@", bib_text) if entry.strip()]


def extract_bibtex_field(entry: str, field: str) -> str:
    match = re.search(rf"(?ms)^\s*{re.escape(field)}\s*=\s*([\"{{])", entry)
    if not match:
        return ""

    opener = match.group(1)
    index = match.end()
    if opener == '"':
        chars: list[str] = []
        escaped = False
        while index < len(entry):
            char = entry[index]
            if char == '"' and not escaped:
                return "".join(chars)
            chars.append(char)
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
            index += 1
        return "".join(chars)

    depth = 1
    chars = []
    while index < len(entry):
        char = entry[index]
        if char == "{":
            depth += 1
            chars.append(char)
        elif char == "}":
            depth -= 1
            if depth == 0:
                return "".join(chars)
            chars.append(char)
        else:
            chars.append(char)
        index += 1
    return "".join(chars)


def parse_acl_long_bibtex(bib_text: str) -> dict[int, dict[str, str]]:
    papers: dict[int, dict[str, str]] = {}
    for entry in split_bibtex_entries(bib_text):
        if not entry.startswith("@inproceedings"):
            continue

        url = extract_bibtex_field(entry, "url")
        number_match = re.search(r"/2026\.acl-long\.(\d+)/", url)
        if not number_match:
            continue

        key_match = re.match(r"@inproceedings\{([^,]+),", entry)
        number = int(number_match.group(1))
        papers[number] = {
            "bibtex_key": key_match.group(1) if key_match else "",
            "url": url,
            "doi": extract_bibtex_field(entry, "doi"),
            "pages": extract_bibtex_field(entry, "pages"),
        }
    return papers


def _record_fragment(section: str, number: int, next_number: int | None) -> str:
    marker = f"https://aclanthology.org/2026.acl-long.{number}.pdf"
    start = section.find(marker)
    if start < 0:
        raise ValueError(f"ACL paper {number} PDF marker not found")

    if next_number is None:
        end = len(section)
    else:
        next_marker = f"https://aclanthology.org/2026.acl-long.{next_number}.pdf"
        end = section.find(next_marker, start + len(marker))
        if end < 0:
            end = len(section)
    return section[start:end]


def parse_acl_long_html(section: str, numbers: list[int]) -> dict[int, dict[str, Any]]:
    parsed: dict[int, dict[str, Any]] = {}
    for index, number in enumerate(numbers):
        next_number = numbers[index + 1] if index + 1 < len(numbers) else None
        fragment = _record_fragment(section, number, next_number)

        title_match = re.search(
            rf"<strong><a[^>]+href=/2026\.acl-long\.{number}/>(.*?)</a></strong>",
            fragment,
            flags=re.DOTALL,
        )
        if not title_match:
            raise ValueError(f"ACL paper {number} title not found")

        author_match = re.search(
            rf"</strong><br>(.*?)</span>\s*</div>",
            fragment,
            flags=re.DOTALL,
        )
        author_text = strip_html(author_match.group(1)) if author_match else ""
        authors = [clean_text(author) for author in author_text.split("|") if clean_text(author)]

        abstract = ""
        abstract_match = re.search(
            rf"id=[\"']?abstract-2026--acl-long--{number}[\"']?[^>]*>.*?<div class=\"card-body p-3 small\">(.*?)</div>\s*</div>",
            fragment,
            flags=re.DOTALL,
        )
        if abstract_match:
            abstract = strip_html(abstract_match.group(1))

        parsed[number] = {
            "title": strip_html(title_match.group(1)),
            "authors": authors,
            "abstract": abstract,
            "pdf": f"https://aclanthology.org/2026.acl-long.{number}.pdf",
        }
    return parsed


def build_acl_long_rows(
    event_html: str,
    bib_text: str,
    *,
    venue: str = CONFERENCE_VENUE,
    primary_area: str = PRIMARY_AREA,
) -> list[dict[str, Any]]:
    bib_papers = parse_acl_long_bibtex(bib_text)
    numbers = sorted(bib_papers)
    section = extract_acl_long_section(event_html)
    html_papers = parse_acl_long_html(section, numbers)

    rows: list[dict[str, Any]] = []
    for sort_order, number in enumerate(numbers, start=1):
        paper_id = f"2026.acl-long.{number}"
        html_paper = html_papers[number]
        bib_paper = bib_papers[number]
        rows.append(
            {
                "id": paper_id,
                "content": {
                    "title": {"value": html_paper["title"]},
                    "abstract": {"value": html_paper["abstract"]},
                    "authors": {"value": html_paper["authors"]},
                    "keywords": {"value": []},
                    "pdf": {"value": html_paper["pdf"]},
                    "venue": {"value": venue},
                    "primary_area": {"value": primary_area},
                    "sort_order": {"value": sort_order},
                },
                "acl": {
                    "anthology_id": paper_id,
                    "url": bib_paper.get("url") or f"https://aclanthology.org/{paper_id}/",
                    "doi": bib_paper.get("doi"),
                    "pages": bib_paper.get("pages"),
                    "bibtex_key": bib_paper.get("bibtex_key"),
                },
            }
        )
    return rows


def write_jsonl(rows: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build import-ready ACL 2026 Long Papers JSONL")
    parser.add_argument("--event-url", default=ACL_EVENT_URL)
    parser.add_argument("--bib-url", default=ACL_LONG_BIB_URL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--venue", default=CONFERENCE_VENUE)
    parser.add_argument("--primary-area", default=PRIMARY_AREA)
    parser.add_argument("--expected-count", type=int, default=2222)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    event_html = fetch_text(args.event_url)
    bib_text = fetch_text(args.bib_url)
    rows = build_acl_long_rows(
        event_html,
        bib_text,
        venue=args.venue,
        primary_area=args.primary_area,
    )

    if args.expected_count is not None and len(rows) != args.expected_count:
        print(
            f"Error: expected {args.expected_count} ACL long papers, got {len(rows)}",
            file=sys.stderr,
        )
        return 1

    missing_abstracts = [row["id"] for row in rows if not row["content"]["abstract"]["value"]]
    write_jsonl(rows, args.output)
    print(f"Wrote {len(rows)} ACL 2026 Long papers to {args.output}")
    if missing_abstracts:
        print(f"Papers without ACL Anthology abstract: {', '.join(missing_abstracts[:20])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
