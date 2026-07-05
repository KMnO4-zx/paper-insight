#!/usr/bin/env python3
"""Save temporary OpenReview credentials outside the repository."""

from __future__ import annotations

import argparse
import json
from getpass import getpass
from pathlib import Path


DEFAULT_OUTPUT = Path("/tmp/openreview_credentials.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Prompt for OpenReview credentials and write them to a temporary "
            "0600 JSON file for local verification scripts."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Credential file path. Default: {DEFAULT_OUTPUT}",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    username = input("OpenReview username/profile id (for example ~First_Last1): ").strip()
    if not username:
        raise SystemExit("OpenReview username/profile id cannot be empty")

    password = getpass("OpenReview password: ")
    if not password:
        raise SystemExit("OpenReview password cannot be empty")

    output_path = args.output.expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"username": username, "password": password}),
        encoding="utf-8",
    )
    output_path.chmod(0o600)

    print(f"wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
