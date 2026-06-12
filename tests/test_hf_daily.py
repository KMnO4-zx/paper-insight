import sys
from contextlib import contextmanager
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import database
from hf_daily import select_top_hf_daily_entries


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
                "id": "hf:2604.00001",
                "title": "Repeated Paper",
                "abstract": "Summary",
                "keywords": [],
                "pdf": "https://arxiv.org/pdf/2604.00001",
                "venue": "Hugging Face Daily",
                "primary_area": "HF Daily Top 1",
                "llm_response": None,
                "created_at": None,
                "hf_daily_date": date(2026, 6, 2),
                "hf_daily_rank": 1,
                "hf_daily_upvotes": 200,
                "hf_daily_thumbnail": "https://example.com/thumb.png",
                "hf_daily_discussion_id": "discussion-1",
                "hf_daily_project_page": "https://example.com/project",
                "hf_daily_github_repo": "https://github.com/example/repo",
                "hf_daily_github_stars": 42,
                "hf_daily_num_comments": 7,
            }
        ]


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_instance = cursor

    def cursor(self):
        return self.cursor_instance


def test_select_top_hf_daily_entries_sorts_and_deduplicates_by_upvotes():
    entries = [
        {
            "paper": {
                "id": "2604.00001",
                "title": "Low Vote Paper",
                "summary": "Summary",
                "upvotes": 1,
                "authors": [{"name": "Alice"}],
                "ai_keywords": ["rl"],
            },
            "thumbnail": "https://example.com/1.png",
            "numComments": 2,
        },
        {
            "paper": {
                "id": "2604.00002",
                "title": "High Vote Paper",
                "summary": "Summary",
                "upvotes": 10,
                "authors": [{"name": "Bob"}],
                "ai_keywords": ["vision"],
                "githubRepo": "https://github.com/example/repo",
                "githubStars": 42,
            },
            "numComments": 4,
        },
        {
            "paper": {
                "id": "2604.00001",
                "title": "Low Vote Paper Updated",
                "summary": "Updated",
                "upvotes": 5,
                "authors": [{"name": "Alice"}],
                "ai_keywords": ["updated"],
            },
        },
    ]

    selected = select_top_hf_daily_entries(entries, top_n=2)

    assert [entry["source_id"] for entry in selected] == ["2604.00002", "2604.00001"]
    assert [entry["daily"]["rank"] for entry in selected] == [1, 2]
    assert selected[0]["paper"]["id"] == "hf:2604.00002"
    assert selected[0]["paper"]["pdf"] == "https://arxiv.org/pdf/2604.00002"
    assert selected[0]["paper"]["venue"] == "Hugging Face Daily"
    assert selected[0]["daily"]["github_repo"] == "https://github.com/example/repo"
    assert selected[0]["daily"]["github_stars"] == 42
    assert selected[1]["paper"]["title"] == "Low Vote Paper Updated"
    assert selected[1]["paper"]["primary_area"] == "HF Daily Top 2"


def test_select_top_hf_daily_entries_skips_invalid_entries():
    selected = select_top_hf_daily_entries(
        [
            {"paper": {"id": "", "title": "Missing ID"}},
            {"paper": {"id": "2604.00003", "title": ""}},
            {"not_paper": {}},
        ],
        top_n=5,
    )

    assert selected == []


def test_get_hf_daily_papers_deduplicates_papers_by_latest_daily_record(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, {}))

    papers, total = database.get_hf_daily_papers(offset=0, limit=8)

    assert total == 1
    assert [paper["id"] for paper in papers] == ["hf:2604.00001"]
    assert papers[0]["hf_daily"] == {
        "daily_date": date(2026, 6, 2),
        "rank": 1,
        "upvotes": 200,
        "thumbnail": "https://example.com/thumb.png",
        "discussion_id": "discussion-1",
        "project_page": "https://example.com/project",
        "github_repo": "https://github.com/example/repo",
        "github_stars": 42,
        "num_comments": 7,
    }

    count_sql = cursor.calls[0][0]
    list_sql = cursor.calls[1][0]
    assert "SELECT DISTINCT h.paper_id" in count_sql
    assert "DISTINCT ON (h.paper_id)" in list_sql
    assert "h.daily_date DESC" in list_sql
    assert "h.upvotes DESC" in list_sql


def test_get_hf_daily_papers_applies_read_filter(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, {}))

    papers, total = database.get_hf_daily_papers(
        offset=0,
        limit=8,
        user_id="user-1",
        read_status="read",
    )

    assert total == 1
    assert [paper["id"] for paper in papers] == ["hf:2604.00001"]
    count_sql = cursor.calls[0][0]
    count_params = cursor.calls[0][1]
    list_sql = cursor.calls[1][0]
    list_params = cursor.calls[1][1]

    assert "EXISTS" in count_sql
    assert "paper_marks pm_read" in count_sql
    assert "pm_read.viewed = TRUE" in count_sql
    assert "EXISTS" in list_sql
    assert count_params == ["user-1"]
    assert list_params == ["user-1", 8, 0]
