from __future__ import annotations

import json
import re
from typing import Any

from prompt import KEYWORD_EXTRACTION_PROMPT


MAX_KEYWORDS = 8


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("keyword extraction response is not a JSON object")
    return parsed


def _is_provider_content_block_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    text = str(exc).lower()
    return (
        status_code == 451
        or "censorship_blocked" in text
        or "unavailable for legal reasons" in text
        or "content you provided or machine outputted is blocked" in text
    )


def normalize_keyword(value: object) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.strip(" \t\r\n,;:.")
    if not text:
        return None
    if len(text) > 80:
        return None
    return text


def normalize_keyword_result(raw_result: dict[str, Any]) -> dict[str, Any]:
    raw_keywords = raw_result.get("keywords")
    if not isinstance(raw_keywords, list):
        raw_keywords = []

    keywords: list[str] = []
    seen: set[str] = set()
    for value in raw_keywords:
        keyword = normalize_keyword(value)
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        keywords.append(keyword)
        if len(keywords) >= MAX_KEYWORDS:
            break

    try:
        confidence = float(raw_result.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "keywords": keywords,
        "meta": {
            "confidence": max(0.0, min(confidence, 1.0)),
            "reason": str(raw_result.get("reason") or "").strip()[:2000],
        },
    }


def _build_user_prompt(paper_info: dict[str, Any]) -> tuple[str, str]:
    title = str(paper_info.get("title") or "").strip()
    abstract = str(paper_info.get("abstract") or "").strip()
    source = "title_abstract" if abstract else "title"
    user_prompt = "\n".join(
        [
            f"paper_id: {paper_info.get('id') or ''}",
            f"title: {title}",
            f"venue: {paper_info.get('venue') or ''}",
            f"primary_area: {paper_info.get('primary_area') or ''}",
            f"source: {source}",
            "",
            "abstract:",
            abstract,
        ]
    )
    return user_prompt, source


async def extract_keywords_for_paper(llm, paper_info: dict[str, Any]) -> dict[str, Any]:
    title = str(paper_info.get("title") or "").strip()
    abstract = str(paper_info.get("abstract") or "").strip()
    if not title and not abstract:
        return {
            "keywords": [],
            "source": "empty_metadata",
            "meta": {"confidence": 0.0, "reason": "empty_title_and_abstract"},
        }

    user_prompt, source = _build_user_prompt(paper_info)
    try:
        raw_response = await llm.chat(
            [
                {"role": "system", "content": KEYWORD_EXTRACTION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0,
            _usage_context="keyword_enrichment",
        )
    except Exception as exc:
        if not _is_provider_content_block_error(exc):
            raise
        return {
            "keywords": [],
            "source": source,
            "meta": {
                "confidence": 0.0,
                "reason": "provider_content_blocked",
                "provider_error": str(exc)[:2000],
            },
        }

    try:
        parsed = _extract_json_object(raw_response or "")
        normalized = normalize_keyword_result(parsed)
    except Exception as exc:
        return {
            "keywords": [],
            "source": source,
            "meta": {
                "confidence": 0.0,
                "reason": "parse_error",
                "parse_error": str(exc)[:500],
                "raw_response": (raw_response or "")[:2000],
            },
        }

    normalized["source"] = source
    normalized["meta"] = {
        **normalized["meta"],
        "source": source,
    }
    return normalized
