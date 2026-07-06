import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from keyword_enrichment import extract_keywords_for_paper, normalize_keyword_result


def test_normalize_keyword_result_dedupes_and_limits_keywords():
    result = normalize_keyword_result(
        {
            "keywords": [
                "Retrieval Augmented Generation",
                "retrieval augmented generation",
                "  black-box API  ",
                "x" * 81,
                "LLM Services",
            ],
            "confidence": "0.7",
            "reason": "ok",
        }
    )

    assert result["keywords"] == [
        "Retrieval Augmented Generation",
        "black-box API",
        "LLM Services",
    ]
    assert result["meta"]["confidence"] == 0.7


class FakeLLM:
    async def chat(self, messages, **kwargs):
        self.messages = messages
        self.kwargs = kwargs
        return '{"keywords":["dialog memory","graph memory","long-term memory"],"confidence":0.8,"reason":"title and abstract"}'


@pytest.mark.asyncio
async def test_extract_keywords_for_paper_uses_title_and_abstract():
    llm = FakeLLM()
    result = await extract_keywords_for_paper(
        llm,
        {
            "id": "2026.acl-long.1232",
            "title": "Does Memory Need Graphs?",
            "abstract": "We study graph-based long-term dialog memory.",
            "venue": "ACL 2026 Long",
        },
    )

    assert result["keywords"] == ["dialog memory", "graph memory", "long-term memory"]
    assert result["source"] == "title_abstract"
    assert llm.kwargs["_usage_context"] == "keyword_enrichment"


class BlockedLLM:
    async def chat(self, messages, **kwargs):
        raise RuntimeError("Error code: 451 - censorship_blocked")


@pytest.mark.asyncio
async def test_extract_keywords_content_block_is_recordable_empty_result():
    result = await extract_keywords_for_paper(
        BlockedLLM(),
        {"id": "paper-1", "title": "Blocked paper", "abstract": "blocked"},
    )

    assert result["keywords"] == []
    assert result["meta"]["reason"] == "provider_content_blocked"
