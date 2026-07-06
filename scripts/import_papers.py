#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

repo_root = Path(__file__).parent.parent
sys.path.insert(0, str(repo_root / "backend"))

from config import settings

DATABASE_URL = settings.database.url
OPENREVIEW_URL_PATTERN = re.compile(r"^https://openreview\.net/(?:attachment|pdf)\?")


def _normalize_pdf_url(paper_id: str, pdf_url: str | None) -> str | None:
    if pdf_url is None:
        return None

    normalized_url = pdf_url.strip()
    if not normalized_url:
        return None

    if OPENREVIEW_URL_PATTERN.match(normalized_url):
        return f"https://openreview.net/pdf?id={paper_id}"

    return normalized_url


def import_conference(conference_name: str):
    """Import papers from a conference directory."""
    if not DATABASE_URL:
        print("Error: database.url not found in config.yaml")
        sys.exit(1)

    data_dir = repo_root / "crawled_data" / conference_name

    if not data_dir.exists():
        print(f"Error: Directory {data_dir} does not exist")
        return

    jsonl_files = list(data_dir.glob("*.jsonl"))
    if not jsonl_files:
        print(f"No JSONL files found in {data_dir}")
        return

    total_papers = 0
    batch_size = 100

    for jsonl_file in jsonl_files:
        print(f"\nProcessing {jsonl_file.name}...")

        papers_batch: list[tuple] = []
        authors_batch: list[tuple] = []
        keywords_batch: list[tuple] = []

        with open(jsonl_file, "r", encoding="utf-8") as file:
            for line_num, line in enumerate(file, 1):
                try:
                    paper_row, author_rows, keyword_rows = _parse_line(line)
                    papers_batch.append(paper_row)
                    authors_batch.extend(author_rows)
                    keywords_batch.extend(keyword_rows)

                    if len(papers_batch) >= batch_size:
                        _insert_batch(papers_batch, authors_batch, keywords_batch)
                        total_papers += len(papers_batch)
                        print(f"  Imported {total_papers} papers...")
                        papers_batch = []
                        authors_batch = []
                        keywords_batch = []

                except Exception as exc:
                    print(f"  Error on line {line_num}: {exc}")
                    continue

        if papers_batch:
            _insert_batch(papers_batch, authors_batch, keywords_batch)
            total_papers += len(papers_batch)

    print(f"\n✓ Successfully imported {total_papers} papers from {conference_name}")


def _parse_line(line: str) -> tuple[tuple, list[tuple], list[tuple]]:
    paper = json.loads(line)
    paper_id = paper["id"]
    content = paper["content"]
    keyword_values = content.get("keywords", {}).get("value", [])

    paper_row = (
        paper_id,
        content["title"]["value"],
        content["abstract"]["value"],
        Jsonb(keyword_values),
        _normalize_pdf_url(paper_id, content.get("pdf", {}).get("value")),
        content["venue"]["value"],
        content["primary_area"]["value"],
        _optional_int(content.get("sort_order", {}).get("value")),
    )

    author_rows = [
        (paper_id, author, index)
        for index, author in enumerate(content["authors"]["value"])
    ]
    keyword_rows = [
        (paper_id, keyword)
        for keyword in keyword_values
    ]

    return paper_row, author_rows, keyword_rows


def _optional_int(value):
    if value is None or value == "":
        return None
    return int(value)


def _insert_batch(
    papers: list[tuple],
    authors: list[tuple],
    keywords: list[tuple],
):
    """Insert a batch of papers, authors, and keywords in one transaction."""
    paper_ids = [paper[0] for paper in papers]

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                    """
                    INSERT INTO papers (id, title, abstract, keywords, pdf, venue, primary_area, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        abstract = EXCLUDED.abstract,
                        keywords = CASE
                            WHEN jsonb_array_length(EXCLUDED.keywords) > 0 THEN EXCLUDED.keywords
                            ELSE papers.keywords
                        END,
                        pdf = EXCLUDED.pdf,
                        venue = EXCLUDED.venue,
                        primary_area = EXCLUDED.primary_area,
                    sort_order = EXCLUDED.sort_order
                """,
                papers,
            )

            cur.execute("DELETE FROM authors WHERE paper_id = ANY(%s)", (paper_ids,))
            if authors:
                cur.executemany(
                    """
                    INSERT INTO authors (paper_id, author_name, author_order)
                    VALUES (%s, %s, %s)
                    """,
                    authors,
                )

            keyword_paper_ids = sorted({paper_id for paper_id, _keyword in keywords})
            if keyword_paper_ids:
                cur.execute("DELETE FROM keywords WHERE paper_id = ANY(%s)", (keyword_paper_ids,))
            if keywords:
                cur.executemany(
                    """
                    INSERT INTO keywords (paper_id, keyword)
                    VALUES (%s, %s)
                    """,
                    keywords,
                )

        conn.commit()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Import papers from JSONL files into PostgreSQL")
    parser.add_argument(
        "--conference",
        required=True,
        help="Conference name (e.g., neurips_2025, iclr_2026)",
    )

    args = parser.parse_args()
    import_conference(args.conference)
