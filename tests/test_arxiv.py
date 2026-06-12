import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import database
from arxiv import (
    arxiv_id_from_paper_id,
    build_arxiv_paper_id,
    normalize_arxiv_id,
    parse_arxiv_api_response,
)


ARXIV_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2605.29707v1</id>
    <updated>2026-05-28T12:34:56Z</updated>
    <published>2026-05-27T01:23:45Z</published>
    <title>  A Useful Paper
      About Agents </title>
    <summary>
      This paper studies agent systems.
    </summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Example</name></author>
    <arxiv:primary_category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <link title="pdf" href="https://arxiv.org/pdf/2605.29707v1" rel="related" type="application/pdf"/>
  </entry>
</feed>
"""


class FakeCursor:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))

    def fetchone(self):
        return {"total": 1}

    def fetchall(self):
        return [
            {
                "id": "arxiv:2605.29707",
                "title": "A Useful Paper",
                "abstract": "Summary",
                "keywords": [],
                "pdf": "https://arxiv.org/pdf/2605.29707",
                "venue": "arXiv",
                "primary_area": "cs.AI",
                "llm_response": "analysis",
                "created_at": None,
                "arxiv_id": "2605.29707",
                "arxiv_url": "https://arxiv.org/abs/2605.29707",
                "arxiv_pdf_url": "https://arxiv.org/pdf/2605.29707",
                "arxiv_published_at": datetime(2026, 5, 27, tzinfo=timezone.utc),
                "arxiv_updated_at": datetime(2026, 5, 28, tzinfo=timezone.utc),
                "arxiv_added_at": datetime(2026, 6, 10, tzinfo=timezone.utc),
                "arxiv_added_by_user_id": None,
                "arxiv_metadata": {"primary_category": "cs.AI"},
            }
        ]


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_instance = cursor

    def cursor(self):
        return self.cursor_instance


def test_normalize_arxiv_id_accepts_supported_inputs():
    assert normalize_arxiv_id("2605.29707") == "2605.29707"
    assert normalize_arxiv_id("arXiv:2605.29707v2") == "2605.29707"
    assert normalize_arxiv_id("https://arxiv.org/abs/2605.29707") == "2605.29707"
    assert normalize_arxiv_id("https://arxiv.org/pdf/2605.29707.pdf") == "2605.29707"
    assert normalize_arxiv_id("https://arxiv.org/abs/hep-th/9901001v1") == "hep-th/9901001"
    assert build_arxiv_paper_id("hep-th/9901001") == "arxiv:hep-th_9901001"
    assert arxiv_id_from_paper_id("arxiv:hep-th_9901001") == "hep-th/9901001"


def test_parse_arxiv_api_response_builds_paper_payload():
    payload = parse_arxiv_api_response(ARXIV_XML, "2605.29707")

    assert payload["paper"] == {
        "id": "arxiv:2605.29707",
        "title": "A Useful Paper About Agents",
        "abstract": "This paper studies agent systems.",
        "authors": ["Alice Example", "Bob Example"],
        "keywords": ["cs.AI", "cs.LG"],
        "pdf": "https://arxiv.org/pdf/2605.29707v1",
        "venue": "arXiv",
        "primary_area": "cs.AI",
    }
    assert payload["arxiv"]["arxiv_id"] == "2605.29707"
    assert payload["arxiv"]["published_at"] == datetime(2026, 5, 27, 1, 23, 45, tzinfo=timezone.utc)
    assert payload["arxiv"]["updated_at"] == datetime(2026, 5, 28, 12, 34, 56, tzinfo=timezone.utc)


def test_get_arxiv_papers_lists_analyzed_recent_papers(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, {}))

    papers, total = database.get_arxiv_papers(offset=0, limit=6)

    assert total == 1
    assert papers[0]["id"] == "arxiv:2605.29707"
    assert papers[0]["arxiv"]["arxiv_id"] == "2605.29707"
    assert papers[0]["arxiv"]["published_at"] == datetime(2026, 5, 27, tzinfo=timezone.utc)

    count_sql = cursor.calls[0][0]
    list_sql = cursor.calls[1][0]
    assert "p.llm_response IS NOT NULL" in count_sql
    assert "ORDER BY a.added_at DESC" in list_sql


def test_get_arxiv_papers_applies_search_filters(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, {}))

    papers, total = database.get_arxiv_papers(
        offset=0,
        limit=6,
        search="agent",
        search_title=True,
        search_abstract=False,
        search_keywords=True,
    )

    assert total == 1
    assert papers[0]["id"] == "arxiv:2605.29707"
    count_sql = cursor.calls[0][0]
    count_params = cursor.calls[0][1]
    list_sql = cursor.calls[1][0]
    list_params = cursor.calls[1][1]

    assert "p.llm_response IS NOT NULL" in count_sql
    assert "p.title ILIKE %s" in count_sql
    assert "p.abstract ILIKE %s" not in count_sql
    assert "keywords.keyword ILIKE %s" in count_sql
    assert count_params == ["%agent%", "%agent%"]
    assert list_params == ["%agent%", "%agent%", 6, 0]
    assert "ORDER BY a.added_at DESC" in list_sql


def test_get_arxiv_papers_applies_unread_filter(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, {}))

    papers, total = database.get_arxiv_papers(
        offset=0,
        limit=6,
        user_id="user-1",
        read_status="unread",
    )

    assert total == 1
    assert papers[0]["id"] == "arxiv:2605.29707"
    count_sql = cursor.calls[0][0]
    count_params = cursor.calls[0][1]
    list_sql = cursor.calls[1][0]
    list_params = cursor.calls[1][1]

    assert "NOT EXISTS" in count_sql
    assert "paper_marks pm_unread" in count_sql
    assert "pm_unread.viewed = TRUE" in count_sql
    assert "NOT EXISTS" in list_sql
    assert count_params == ["user-1"]
    assert list_params == ["user-1", 6, 0]
