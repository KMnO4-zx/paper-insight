#!/usr/bin/env python3
"""Download ICML 2026 OpenReview metadata without importing it."""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = REPO_ROOT / "crawler" / "configs" / "icml_2026.yaml"
DEFAULT_CREDENTIALS_PATH = Path("/tmp/openreview_credentials.json")
DEFAULT_OUTPUT_DIR = REPO_ROOT / "crawled_data" / "icml_2026"
LOGIN_URL = "https://api2.openreview.net/login"
REQUIRED_CONTENT_FIELDS = (
    "title",
    "abstract",
    "authors",
    "keywords",
    "pdf",
    "venue",
    "primary_area",
)
HEADERS = {
    "Accept": "application/json,text/*;q=0.99",
    "User-Agent": "paper-online/0.1 (ICML 2026 metadata downloader; contact: local maintainer)",
    "Referer": "https://openreview.net/",
    "Origin": "https://openreview.net",
}


@dataclass(frozen=True)
class DownloadResult:
    venue_type: str
    venue: str
    output_path: str
    expected_count: int
    row_count: int
    downloaded_this_run: int
    validation: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download ICML 2026 accepted-note metadata from OpenReview into "
            "crawled_data/icml_2026. This does not import anything into PostgreSQL."
        )
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help=f"OpenReview crawler config. Default: {DEFAULT_CONFIG_PATH}",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=f"Output directory. Default: config output_dir under {REPO_ROOT / 'crawled_data'}",
    )
    parser.add_argument(
        "--venue",
        action="append",
        help="Venue type to download: spotlight or regular. Repeat to download both. Default: all.",
    )
    parser.add_argument(
        "--credentials",
        type=Path,
        default=DEFAULT_CREDENTIALS_PATH,
        help=f"Temporary credential JSON path. Default: {DEFAULT_CREDENTIALS_PATH}",
    )
    parser.add_argument(
        "--token-env",
        default="OPENREVIEW_TOKEN",
        help="Environment variable containing an existing OpenReview bearer token.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="OpenReview page size. Default comes from config, currently 25.",
    )
    parser.add_argument(
        "--min-delay",
        type=float,
        default=None,
        help="Minimum seconds to sleep between successful note API requests.",
    )
    parser.add_argument(
        "--max-delay",
        type=float,
        default=None,
        help="Maximum seconds to sleep between successful note API requests.",
    )
    parser.add_argument(
        "--pause-between-venues",
        type=float,
        default=None,
        help="Seconds to sleep between spotlight and regular downloads.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=6,
        help="Retries for transient note API failures. Login is not retried.",
    )
    parser.add_argument(
        "--retry-base-delay",
        type=float,
        default=30.0,
        help="Base seconds for exponential retry backoff.",
    )
    parser.add_argument(
        "--retry-max-delay",
        type=float,
        default=300.0,
        help="Maximum seconds for a single retry sleep.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=60.0,
        help="Read timeout in seconds for HTTP requests.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete existing JSONL files and start from offset 0.",
    )
    parser.add_argument(
        "--allow-validation-issues",
        action="store_true",
        help="Exit 0 even if downloaded rows have missing import-required fields.",
    )
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    if not isinstance(config, dict):
        raise SystemExit(f"Config must be a YAML object: {path}")
    return config


def build_output_dir(config: dict[str, Any], requested_output_dir: Path | None) -> Path:
    if requested_output_dir is not None:
        return requested_output_dir.expanduser().resolve()
    output_dir = config.get("conference", {}).get("output_dir")
    if not output_dir:
        return DEFAULT_OUTPUT_DIR
    return REPO_ROOT / "crawled_data" / output_dir


def selected_venues(config: dict[str, Any], requested: list[str] | None) -> list[dict[str, str]]:
    venues = config.get("venues")
    if not isinstance(venues, list) or not venues:
        raise SystemExit("Config has no venues")

    clean_requested = {item.strip().lower() for item in requested or [] if item.strip()}
    selected: list[dict[str, str]] = []

    for venue in venues:
        if not isinstance(venue, dict):
            continue
        venue_type = str(venue.get("type", "")).strip()
        venue_name = str(venue.get("venue", "")).strip()
        if not venue_type or not venue_name:
            continue
        if clean_requested and venue_type.lower() not in clean_requested:
            continue
        selected.append({"type": venue_type, "venue": venue_name})

    if clean_requested:
        found = {venue["type"].lower() for venue in selected}
        missing = sorted(clean_requested - found)
        if missing:
            raise SystemExit(f"Unknown venue type(s): {', '.join(missing)}")
    if not selected:
        raise SystemExit("No venues selected")
    return selected


def build_session(args: argparse.Namespace) -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)

    token = os.environ.get(args.token_env)
    if token:
        session.headers["Authorization"] = f"Bearer {token.strip()}"
        print(f"Using OpenReview token from ${args.token_env}")
        return session

    credentials_path = args.credentials.expanduser()
    if not credentials_path.exists():
        raise SystemExit(
            "OpenReview credentials not found. Run:\n"
            "  uv run python scripts/save_openreview_credentials.py\n"
            f"Then rerun this downloader. Expected: {credentials_path}"
        )

    credentials = read_credentials(credentials_path)
    username = credentials.get("username") or credentials.get("id") or credentials.get("email")
    password = credentials.get("password")
    if not username or not password:
        raise SystemExit(f"Credential file must contain username/id and password: {credentials_path}")

    print("Logging in to OpenReview API2 once...")
    response = session.post(
        LOGIN_URL,
        json={"id": username, "password": password},
        timeout=(10, args.timeout),
    )
    if response.status_code != 200:
        detail = response.text[:300].replace("\n", " ")
        raise SystemExit(f"OpenReview login failed: HTTP {response.status_code}: {detail}")

    data = response.json()
    token = data.get("token")
    if not token:
        raise SystemExit("OpenReview login response did not include a token")
    session.headers["Authorization"] = f"Bearer {token}"
    print("OpenReview login succeeded.")
    return session


def read_credentials(path: Path) -> dict[str, str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Credential file is not valid JSON: {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise SystemExit(f"Credential file must contain a JSON object: {path}")
    return {str(key): str(value) for key, value in raw.items()}


def api_url(config: dict[str, Any], venue: str, offset: int, limit: int) -> str:
    conference = config["conference"]
    settings = config["settings"]
    params = {
        "content.venue": venue,
        "details": "replyCount,presentation,writable",
        "domain": conference["domain"],
        "invitation": conference["invitation"],
        "limit": limit,
        "offset": offset,
    }
    return f"{settings['api_base_url']}?{urlencode(params)}"


def request_json(
    session: requests.Session,
    url: str,
    args: argparse.Namespace,
    context: str,
) -> dict[str, Any]:
    transient_statuses = {429, 500, 502, 503, 504}
    last_error: Exception | None = None

    for attempt in range(args.max_retries + 1):
        try:
            response = session.get(url, timeout=(10, args.timeout))
            if response.status_code == 200:
                data = response.json()
                if not isinstance(data, dict):
                    raise RuntimeError(f"{context}: expected JSON object")
                return data

            if response.status_code in transient_statuses and attempt < args.max_retries:
                wait = retry_sleep_seconds(response, attempt, args)
                print(
                    f"{context}: HTTP {response.status_code}; "
                    f"sleeping {wait:.1f}s before retry {attempt + 1}/{args.max_retries}"
                )
                time.sleep(wait)
                continue

            body = response.text[:500].replace("\n", " ")
            raise RuntimeError(f"{context}: HTTP {response.status_code}: {body}")
        except (requests.Timeout, requests.ConnectionError, requests.JSONDecodeError, RuntimeError) as exc:
            last_error = exc
            if attempt >= args.max_retries:
                break
            wait = retry_sleep_seconds(None, attempt, args)
            print(
                f"{context}: {exc}; sleeping {wait:.1f}s before retry "
                f"{attempt + 1}/{args.max_retries}"
            )
            time.sleep(wait)

    raise RuntimeError(f"{context}: failed after retries: {last_error}")


def retry_sleep_seconds(
    response: requests.Response | None,
    attempt: int,
    args: argparse.Namespace,
) -> float:
    if response is not None:
        retry_after = response.headers.get("Retry-After")
        parsed = parse_retry_after(retry_after)
        if parsed is not None:
            return min(parsed + random.uniform(1.0, 5.0), args.retry_max_delay)

    exponential = args.retry_base_delay * (2**attempt)
    return min(exponential, args.retry_max_delay) + random.uniform(1.0, 5.0)


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(float(value), 0.0)
    except ValueError:
        pass
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max((parsed - datetime.now(timezone.utc)).total_seconds(), 0.0)


def sleep_between_requests(min_delay: float, max_delay: float) -> None:
    wait = random.uniform(min_delay, max_delay)
    print(f"sleeping {wait:.1f}s before next request")
    time.sleep(wait)


def download_venue(
    session: requests.Session,
    config: dict[str, Any],
    venue_config: dict[str, str],
    output_dir: Path,
    args: argparse.Namespace,
    limit: int,
    min_delay: float,
    max_delay: float,
) -> DownloadResult:
    venue_type = venue_config["type"]
    venue = venue_config["venue"]
    output_path = output_dir / f"{venue_type}_papers.jsonl"
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.force and output_path.exists():
        output_path.unlink()

    existing_count = count_jsonl_rows(output_path)
    print(f"\nDownloading {venue} -> {output_path}")
    if existing_count:
        print(f"Found existing JSONL with {existing_count} rows; resume is enabled.")

    first_page = request_json(
        session,
        api_url(config, venue, 0, limit),
        args,
        context=f"{venue_type} offset=0",
    )
    total = int(first_page.get("count") or 0)
    print(f"OpenReview reports {total} notes for {venue}.")

    if total == 0:
        validation = validate_jsonl(output_path, expected_venue=venue)
        return DownloadResult(venue_type, venue, str(output_path), total, validation["row_count"], 0, validation)

    downloaded_this_run = 0
    next_offset = existing_count
    if existing_count >= total:
        print(f"{venue_type}: existing file already has {existing_count}/{total} rows; skipping download.")
    else:
        if existing_count and existing_count % limit != 0:
            raise SystemExit(
                f"Unsafe resume state for {output_path}: {existing_count} rows is not a multiple "
                f"of limit={limit}. Rerun with --force to rebuild it."
            )

        if existing_count == 0:
            notes = expect_notes(first_page, venue_type, 0)
            append_jsonl(output_path, notes)
            downloaded_this_run += len(notes)
            next_offset = limit
            print(f"{venue_type}: saved {downloaded_this_run}/{total} rows this run.")

        while next_offset < total:
            sleep_between_requests(min_delay, max_delay)
            page = request_json(
                session,
                api_url(config, venue, next_offset, limit),
                args,
                context=f"{venue_type} offset={next_offset}",
            )
            notes = expect_notes(page, venue_type, next_offset)
            if not notes:
                raise RuntimeError(f"{venue_type} offset={next_offset}: no notes returned before total was reached")
            append_jsonl(output_path, notes)
            downloaded_this_run += len(notes)
            next_offset += limit
            print(
                f"{venue_type}: saved {min(existing_count + downloaded_this_run, total)}/{total} "
                f"rows ({downloaded_this_run} new this run)."
            )

    validation = validate_jsonl(output_path, expected_venue=venue)
    return DownloadResult(
        venue_type=venue_type,
        venue=venue,
        output_path=str(output_path),
        expected_count=total,
        row_count=validation["row_count"],
        downloaded_this_run=downloaded_this_run,
        validation=validation,
    )


def expect_notes(page: dict[str, Any], venue_type: str, offset: int) -> list[dict[str, Any]]:
    notes = page.get("notes")
    if not isinstance(notes, list):
        raise RuntimeError(f"{venue_type} offset={offset}: response has no notes list")
    return [note for note in notes if isinstance(note, dict)]


def count_jsonl_rows(path: Path) -> int:
    if not path.exists():
        return 0
    rows = 0
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"Invalid JSONL at {path}:{line_number}: {exc}") from exc
            rows += 1
    return rows


def append_jsonl(path: Path, notes: list[dict[str, Any]]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for note in notes:
            handle.write(json.dumps(note, ensure_ascii=False, separators=(",", ":")) + "\n")


def validate_jsonl(path: Path, expected_venue: str) -> dict[str, Any]:
    field_issue_counts = {field: 0 for field in REQUIRED_CONTENT_FIELDS}
    sample_issues: list[dict[str, Any]] = []
    ids: set[str] = set()
    duplicate_ids: list[str] = []
    row_count = 0
    venue_mismatch_count = 0

    if not path.exists():
        return {
            "row_count": 0,
            "duplicate_id_count": 0,
            "duplicate_ids_sample": [],
            "venue_mismatch_count": 0,
            "missing_or_empty_required_fields": field_issue_counts,
            "sample_issues": [],
        }

    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row_count += 1
            note = json.loads(line)
            paper_id = str(note.get("id") or "")
            if paper_id in ids and len(duplicate_ids) < 20:
                duplicate_ids.append(paper_id)
            ids.add(paper_id)

            content = note.get("content")
            if not isinstance(content, dict):
                add_sample_issue(sample_issues, line_number, paper_id, "content", "missing content object")
                for field in REQUIRED_CONTENT_FIELDS:
                    field_issue_counts[field] += 1
                continue

            for field in REQUIRED_CONTENT_FIELDS:
                raw = content.get(field)
                value = raw.get("value") if isinstance(raw, dict) else None
                if is_empty_value(value):
                    field_issue_counts[field] += 1
                    add_sample_issue(sample_issues, line_number, paper_id, field, "missing or empty value")

            venue_value = content.get("venue", {}).get("value") if isinstance(content.get("venue"), dict) else None
            if venue_value != expected_venue:
                venue_mismatch_count += 1
                add_sample_issue(sample_issues, line_number, paper_id, "venue", f"expected {expected_venue!r}")

    return {
        "row_count": row_count,
        "duplicate_id_count": max(row_count - len(ids), 0),
        "duplicate_ids_sample": duplicate_ids,
        "venue_mismatch_count": venue_mismatch_count,
        "missing_or_empty_required_fields": field_issue_counts,
        "sample_issues": sample_issues,
    }


def add_sample_issue(
    sample_issues: list[dict[str, Any]],
    line_number: int,
    paper_id: str,
    field: str,
    reason: str,
) -> None:
    if len(sample_issues) >= 20:
        return
    sample_issues.append(
        {
            "line": line_number,
            "id": paper_id,
            "field": field,
            "reason": reason,
        }
    )


def is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    return False


def write_report(
    output_dir: Path,
    config: dict[str, Any],
    results: list[DownloadResult],
    args: argparse.Namespace,
) -> Path:
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "conference": config.get("conference", {}),
        "api_params": {
            "details": "replyCount,presentation,writable",
            "limit": args.limit,
            "min_delay": args.min_delay,
            "max_delay": args.max_delay,
            "pause_between_venues": args.pause_between_venues,
        },
        "results": [
            {
                "venue_type": result.venue_type,
                "venue": result.venue,
                "output_path": result.output_path,
                "expected_count": result.expected_count,
                "row_count": result.row_count,
                "downloaded_this_run": result.downloaded_this_run,
                "validation": result.validation,
            }
            for result in results
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "download_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report_path


def has_validation_issues(results: list[DownloadResult]) -> bool:
    for result in results:
        validation = result.validation
        if result.expected_count != result.row_count:
            return True
        if validation.get("duplicate_id_count"):
            return True
        if validation.get("venue_mismatch_count"):
            return True
        missing = validation.get("missing_or_empty_required_fields") or {}
        if any(count for count in missing.values()):
            return True
    return False


def main() -> int:
    args = parse_args()
    config = load_config(args.config.expanduser())
    settings = config.get("settings", {})
    limit = args.limit or int(settings.get("limit", 25))
    min_delay = args.min_delay if args.min_delay is not None else float(settings.get("initial_delay", 3.0))
    max_delay = args.max_delay if args.max_delay is not None else float(settings.get("max_delay", 5.0))
    pause_between_venues = (
        args.pause_between_venues
        if args.pause_between_venues is not None
        else float(settings.get("pause_between_venues", 30.0))
    )

    if limit <= 0:
        raise SystemExit("--limit must be positive")
    if min_delay < 0 or max_delay < 0 or min_delay > max_delay:
        raise SystemExit("Delay bounds must satisfy 0 <= min_delay <= max_delay")

    args.limit = limit
    args.min_delay = min_delay
    args.max_delay = max_delay
    args.pause_between_venues = pause_between_venues

    venues = selected_venues(config, args.venue)
    output_dir = build_output_dir(config, args.output_dir)
    session = build_session(args)

    print(f"Output directory: {output_dir}")
    print(f"Selected venues: {', '.join(venue['type'] for venue in venues)}")
    print(f"Page limit: {limit}; delay: {min_delay:.1f}-{max_delay:.1f}s; concurrency: 1")

    results: list[DownloadResult] = []
    for index, venue_config in enumerate(venues):
        if index > 0 and pause_between_venues > 0:
            print(f"Pausing {pause_between_venues:.1f}s before next venue.")
            time.sleep(pause_between_venues)
        results.append(
            download_venue(
                session=session,
                config=config,
                venue_config=venue_config,
                output_dir=output_dir,
                args=args,
                limit=limit,
                min_delay=min_delay,
                max_delay=max_delay,
            )
        )

    report_path = write_report(output_dir, config, results, args)
    print(f"\nWrote report: {report_path}")

    total_rows = sum(result.row_count for result in results)
    total_expected = sum(result.expected_count for result in results)
    print(f"Downloaded metadata rows: {total_rows}/{total_expected}")

    if has_validation_issues(results):
        print("Validation issues were found. Check download_report.json before importing.")
        return 2 if not args.allow_validation_issues else 0

    print("Validation passed: all rows have import-required fields, keywords, and PDF metadata.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
