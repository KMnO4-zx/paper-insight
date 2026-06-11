#!/usr/bin/env python3
"""Build import-ready CHI 2026 JSONL from DBLP and OpenAlex metadata."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import requests


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DBLP_URL = "https://dblp.org/db/conf/chi/chi2026.xml"
OPENALEX_WORKS_URL = "https://api.openalex.org/works"
CONFERENCE_ID = "chi_2026"
CONFERENCE_VENUE = "CHI 2026"
ACM_PROCEEDINGS_DOI = "10.1145/3772318"
ACM_PDF_URL_TEMPLATE = "https://dl.acm.org/doi/pdf/{doi}"
ACM_DOI_URL_TEMPLATE = "https://dl.acm.org/doi/{doi}"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "crawled_data" / CONFERENCE_ID / "main_papers.jsonl"
DEFAULT_CACHE_PATH = REPO_ROOT / "crawled_data" / CONFERENCE_ID / "openalex_cache.json"
USER_AGENT = "paper-online/0.1 (CHI 2026 metadata importer)"


@dataclass(frozen=True)
class DblpPaper:
    id: str
    doi: str
    title: str
    authors: list[str]
    primary_area: str
    pages: str | None
    dblp_key: str | None


def normalize_doi(value: str | None) -> str:
    if not value:
        return ""
    doi = value.strip()
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    doi = doi.removeprefix("doi:")
    return doi.lower()


def paper_id_from_doi(doi: str) -> str:
    normalized = normalize_doi(doi)
    if normalized.startswith("10.1145/"):
        normalized = normalized[len("10.1145/") :]
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return f"chi2026-{slug}"


def parse_dblp_chi_2026(xml_text: str) -> list[DblpPaper]:
    root = ET.fromstring(xml_text)
    current_section = "Human-Computer Interaction"
    papers: list[DblpPaper] = []

    for child in root:
        if child.tag == "h2":
            section = "".join(child.itertext()).strip()
            if section:
                current_section = section
            continue

        if child.tag != "dblpcites":
            continue

        for inproceedings in child.iter("inproceedings"):
            doi = _extract_doi(inproceedings)
            if not doi or not doi.startswith(f"{ACM_PROCEEDINGS_DOI}."):
                continue

            title = _node_text(inproceedings, "title")
            authors = [
                _clean_text(author.text)
                for author in inproceedings.findall("author")
                if _clean_text(author.text)
            ]
            if not title or not authors:
                continue

            papers.append(
                DblpPaper(
                    id=paper_id_from_doi(doi),
                    doi=doi,
                    title=title,
                    authors=authors,
                    primary_area=current_section,
                    pages=_node_text(inproceedings, "pages") or None,
                    dblp_key=inproceedings.attrib.get("key"),
                )
            )

    return papers


def _extract_doi(node: ET.Element) -> str:
    for ee in node.findall("ee"):
        value = _clean_text(ee.text)
        doi = normalize_doi(value)
        if doi:
            return doi
    return ""


def _node_text(node: ET.Element, tag: str) -> str:
    child = node.find(tag)
    if child is None:
        return ""
    return _clean_text("".join(child.itertext()))


def _clean_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def load_dblp_source(source: str) -> str:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        response = requests.get(source, headers={"User-Agent": USER_AGENT}, timeout=60)
        response.raise_for_status()
        return response.text
    return Path(source).read_text(encoding="utf-8")


def load_openalex_cache(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"OpenAlex cache is not valid JSON: {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise SystemExit(f"OpenAlex cache must be a JSON object: {path}")
    return {normalize_doi(key): value for key, value in raw.items() if isinstance(value, dict)}


def save_openalex_cache(path: Path, cache: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(dict(sorted(cache.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def fetch_openalex_metadata(
    dois: list[str],
    cache: dict[str, dict[str, Any]],
    cache_path: Path,
    *,
    batch_size: int = 50,
    mailto: str | None = None,
    sleep_seconds: float = 0.2,
) -> dict[str, dict[str, Any]]:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    normalized_dois = [normalize_doi(doi) for doi in dois]
    missing = [doi for doi in normalized_dois if doi and doi not in cache]

    for index in range(0, len(missing), batch_size):
        batch = missing[index : index + batch_size]
        params = {
            "filter": "doi:" + "|".join(batch),
            "select": "doi,title,abstract_inverted_index,keywords,locations,primary_location,open_access,ids",
            "per-page": str(len(batch)),
        }
        if mailto:
            params["mailto"] = mailto

        data = _get_openalex_batch(session, params)
        for item in data.get("results", []):
            doi = normalize_doi(item.get("doi"))
            if doi:
                cache[doi] = item

        for doi in batch:
            cache.setdefault(doi, {})

        save_openalex_cache(cache_path, cache)
        print(f"Fetched OpenAlex metadata for {min(index + len(batch), len(missing))}/{len(missing)} missing DOI(s)")
        if sleep_seconds:
            time.sleep(sleep_seconds)

    return cache


def _get_openalex_batch(session: requests.Session, params: dict[str, str]) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = session.get(OPENALEX_WORKS_URL, params=params, timeout=60)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < 3:
                time.sleep(2**attempt)
                continue
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("OpenAlex returned a non-object JSON response")
            return data
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(2**attempt)
                continue
    raise RuntimeError(f"OpenAlex request failed after retries: {last_error}") from last_error


def abstract_from_openalex(item: dict[str, Any]) -> str:
    inverted = item.get("abstract_inverted_index")
    if not isinstance(inverted, dict) or not inverted:
        return ""

    max_position = -1
    for positions in inverted.values():
        if isinstance(positions, list):
            for position in positions:
                if isinstance(position, int):
                    max_position = max(max_position, position)

    if max_position < 0:
        return ""

    words = [""] * (max_position + 1)
    for word, positions in inverted.items():
        if not isinstance(word, str) or not isinstance(positions, list):
            continue
        for position in positions:
            if isinstance(position, int) and 0 <= position <= max_position:
                words[position] = word

    return " ".join(word for word in words if word).strip()


def keywords_from_openalex(item: dict[str, Any], primary_area: str) -> list[str]:
    values: list[str] = []
    for keyword in item.get("keywords") or []:
        if not isinstance(keyword, dict):
            continue
        value = _clean_text(keyword.get("display_name"))
        if value:
            values.append(value)
    if primary_area:
        values.append(primary_area)
    return _dedupe_preserving_order(values)[:10]


def choose_pdf_url(doi: str, item: dict[str, Any]) -> str:
    acm_pdf_url = ACM_PDF_URL_TEMPLATE.format(doi=doi)
    for location in item.get("locations") or []:
        if not isinstance(location, dict):
            continue
        pdf_url = _clean_text(location.get("pdf_url"))
        if pdf_url and "dl.acm.org" not in pdf_url.lower():
            return pdf_url
    for location in item.get("locations") or []:
        if not isinstance(location, dict):
            continue
        pdf_url = _clean_text(location.get("pdf_url"))
        if pdf_url:
            return pdf_url
    return acm_pdf_url


def build_jsonl_record(paper: DblpPaper, openalex_item: dict[str, Any]) -> dict[str, Any]:
    title = _clean_text(openalex_item.get("title")) or paper.title
    abstract = abstract_from_openalex(openalex_item)
    keywords = keywords_from_openalex(openalex_item, paper.primary_area)
    pdf_url = choose_pdf_url(paper.doi, openalex_item)
    acm_url = ACM_DOI_URL_TEMPLATE.format(doi=paper.doi)

    return {
        "id": paper.id,
        "forum": paper.doi,
        "license": "CC BY 4.0",
        "domain": "CHI 2026",
        "content": {
            "title": {"value": title},
            "authors": {"value": paper.authors},
            "keywords": {"value": keywords},
            "abstract": {"value": abstract},
            "primary_area": {"value": paper.primary_area},
            "venue": {"value": CONFERENCE_VENUE},
            "pdf": {"value": pdf_url},
            "doi": {"value": paper.doi},
            "acm_url": {"value": acm_url},
            "acm_pdf": {"value": ACM_PDF_URL_TEMPLATE.format(doi=paper.doi)},
            "pages": {"value": paper.pages or ""},
            "source": {"value": "DBLP + OpenAlex"},
            "dblp_key": {"value": paper.dblp_key or ""},
        },
    }


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def _dedupe_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(value)
    return deduped


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build crawled_data/chi_2026 JSONL from DBLP + OpenAlex")
    parser.add_argument("--dblp-source", default=DEFAULT_DBLP_URL, help="DBLP URL or local XML/BHT file")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Output JSONL path")
    parser.add_argument("--openalex-cache", type=Path, default=DEFAULT_CACHE_PATH, help="OpenAlex cache JSON path")
    parser.add_argument("--batch-size", type=int, default=50, help="OpenAlex DOI batch size")
    parser.add_argument("--mailto", help="Optional email for OpenAlex polite pool")
    parser.add_argument("--skip-openalex", action="store_true", help="Use DBLP only; abstracts will be empty")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    xml_text = load_dblp_source(args.dblp_source)
    papers = parse_dblp_chi_2026(xml_text)
    if not papers:
        print("No CHI 2026 papers found in DBLP source", file=sys.stderr)
        return 1

    cache = load_openalex_cache(args.openalex_cache)
    if not args.skip_openalex:
        cache = fetch_openalex_metadata(
            [paper.doi for paper in papers],
            cache,
            args.openalex_cache,
            batch_size=max(1, args.batch_size),
            mailto=args.mailto,
        )

    records = [build_jsonl_record(paper, cache.get(paper.doi, {})) for paper in papers]
    write_jsonl(args.output, records)

    with_abstract = sum(1 for record in records if record["content"]["abstract"]["value"])
    with_non_acm_pdf = sum(
        1
        for record in records
        if "dl.acm.org" not in (record["content"]["pdf"]["value"] or "").lower()
    )
    print(f"Wrote {len(records)} CHI 2026 papers to {args.output}")
    print(f"OpenAlex abstracts: {with_abstract}/{len(records)}")
    print(f"Non-ACM PDF fallbacks: {with_non_acm_pdf}/{len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
