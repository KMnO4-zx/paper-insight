import asyncio
import sys
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import app as app_module
import database


class OverviewCursor:
    def __init__(self, result_sets):
        self.result_sets = list(result_sets)
        self.calls = []
        self.current_rows = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))
        self.current_rows = self.result_sets.pop(0)

    def fetchall(self):
        return self.current_rows


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_instance = cursor

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        return None


def install_fake_connection(monkeypatch, cursor):
    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "_get_connection", fake_get_connection)


def collection_rows(total=0):
    return [
        {
            "id": collection_id,
            "label": label,
            "sort_order": sort_order,
            "total": total if sort_order == 0 else 0,
        }
        for sort_order, (collection_id, label) in enumerate(database.READING_OVERVIEW_COLLECTIONS)
    ]


def test_get_reading_overview_builds_local_activity_latest_hf_and_collection_progress(monkeypatch):
    cursor = OverviewCursor(
        [
            [
                {"activity_date": date(2026, 7, 1), "paper_count": 4},
                {"activity_date": date(2026, 7, 10), "paper_count": 1},
                {"activity_date": date(2026, 7, 11), "paper_count": 2},
                {"activity_date": date(2026, 7, 12), "paper_count": 3},
            ],
            [
                {
                    "daily_date": date(2026, 7, 12),
                    "paper_id": "hf:synthetic-1",
                    "rank": 1,
                    "title": "Synthetic One",
                    "viewed": True,
                },
                {
                    "daily_date": date(2026, 7, 12),
                    "paper_id": "hf:synthetic-2",
                    "rank": 2,
                    "title": "Synthetic Two",
                    "viewed": False,
                },
                {
                    "daily_date": date(2026, 7, 12),
                    "paper_id": "hf:synthetic-3",
                    "rank": 3,
                    "title": "Synthetic Three",
                    "viewed": True,
                },
            ],
            collection_rows(total=3),
            [{"id": "acl_2026", "read": 2}],
        ]
    )
    install_fake_connection(monkeypatch, cursor)

    overview = database.get_reading_overview(
        "session-user-id",
        days=2,
        now=datetime(2026, 7, 13, 0, 30, tzinfo=ZoneInfo("Asia/Shanghai")),
    )

    assert overview["timezone"] == "Asia/Shanghai"
    assert len(overview["activity"]["days"]) == 28
    assert overview["activity"]["days"][0]["date"] == "2026-06-16"
    assert overview["activity"]["days"][-1] == {"date": "2026-07-13", "count": 0}
    assert overview["activity"]["today_count"] == 0
    assert overview["activity"]["month_count"] == 10
    assert overview["activity"]["current_streak"] == 3
    assert overview["hf_daily"] == {
        "daily_date": "2026-07-12",
        "is_today": False,
        "read": 2,
        "total": 3,
        "items": [
            {"paper_id": "hf:synthetic-1", "title": "Synthetic One", "rank": 1, "viewed": True},
            {"paper_id": "hf:synthetic-2", "title": "Synthetic Two", "rank": 2, "viewed": False},
            {"paper_id": "hf:synthetic-3", "title": "Synthetic Three", "rank": 3, "viewed": True},
        ],
    }
    assert overview["collections"][0] == {
        "id": "acl_2026",
        "label": "ACL 2026",
        "read": 2,
        "total": 3,
        "percent": 66.7,
    }
    assert len(overview["collections"]) == 6

    activity_sql, activity_params = cursor.calls[0]
    assert "first_viewed_at AT TIME ZONE %s" in activity_sql
    assert activity_params[:2] == ("Asia/Shanghai", "session-user-id")
    assert activity_params[2] == datetime(2026, 7, 13, 16, tzinfo=timezone.utc)

    hf_sql, hf_params = cursor.calls[1]
    assert "MAX(daily_date)" in hf_sql
    assert "daily_date <= %s" in hf_sql
    assert "LIMIT 5" in hf_sql
    assert hf_params == (date(2026, 7, 13), "session-user-id")

    collection_sql, collection_params = cursor.calls[2]
    assert collection_sql.count("UNION ALL") == 5
    assert "venue >= %s" in collection_sql
    assert "venue < %s" in collection_sql
    assert "venue LIKE %s" in collection_sql
    assert "JOIN papers" not in collection_sql
    assert "search" not in collection_sql.lower()
    assert collection_params[:6] == [
        "acl_2026",
        "ACL 2026",
        0,
        "ACL 2026",
        "ACL 2027",
        "ACL 2026%",
    ]

    read_sql, read_params = cursor.calls[3]
    assert "FROM paper_marks pm" in read_sql
    assert "JOIN papers p ON p.id = pm.paper_id" in read_sql
    assert "pm.user_id = %s" in read_sql
    assert "pm.viewed = TRUE" in read_sql
    assert read_params[-1] == "session-user-id"


def test_get_reading_overview_returns_null_when_no_hf_batch_exists(monkeypatch):
    cursor = OverviewCursor([[], [], collection_rows(), []])
    install_fake_connection(monkeypatch, cursor)

    overview = database.get_reading_overview(
        "session-user-id",
        now=datetime(2026, 7, 13, tzinfo=ZoneInfo("Asia/Shanghai")),
    )

    assert overview["hf_daily"] is None


class StatefulMarkCursor:
    def __init__(self):
        self.state = {"viewed": False, "liked": False, "favorited": False}
        self.calls = []
        self.pending = None
        self.write_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))
        if "SELECT viewed, liked, favorited" in query:
            self.pending = {
                "viewed": self.state["viewed"],
                "liked": self.state["liked"],
                "favorited": self.state["favorited"],
            }
            return

        if "INSERT INTO paper_marks" not in query:
            raise AssertionError(f"unexpected SQL: {query}")

        self.write_count += 1
        event_time = datetime(2026, 7, 10 + self.write_count, 2, tzinfo=timezone.utc)
        viewed, liked, favorited = bool(params[2]), bool(params[3]), bool(params[4])
        first_viewed_at = self.state.get("first_viewed_at")
        if first_viewed_at is None and viewed:
            first_viewed_at = event_time
        viewed_at = self.state.get("viewed_at") if viewed else None
        if viewed and viewed_at is None:
            viewed_at = event_time
        liked_at = self.state.get("liked_at") if liked else None
        if liked and liked_at is None:
            liked_at = event_time
        favorited_at = self.state.get("favorited_at") if favorited else None
        if favorited and favorited_at is None:
            favorited_at = event_time
        self.state = {
            "paper_id": params[1],
            "viewed": viewed,
            "liked": liked,
            "favorited": favorited,
            "first_viewed_at": first_viewed_at,
            "viewed_at": viewed_at,
            "liked_at": liked_at,
            "favorited_at": favorited_at,
            "updated_at": event_time,
        }
        self.pending = dict(self.state)

    def fetchone(self):
        return self.pending


def test_first_viewed_at_survives_cancel_and_implicit_review(monkeypatch):
    cursor = StatefulMarkCursor()
    install_fake_connection(monkeypatch, cursor)

    first = database.set_paper_mark("synthetic-user", "synthetic-paper", viewed=True)
    cancelled = database.set_paper_mark("synthetic-user", "synthetic-paper", viewed=False)
    reviewed = database.set_paper_mark("synthetic-user", "synthetic-paper", liked=True)

    assert first["first_viewed_at"] == datetime(2026, 7, 11, 2, tzinfo=timezone.utc)
    assert cancelled["viewed"] is False
    assert cancelled["viewed_at"] is None
    assert cancelled["first_viewed_at"] == first["first_viewed_at"]
    assert reviewed["liked"] is True
    assert reviewed["viewed"] is True
    assert reviewed["viewed_at"] == datetime(2026, 7, 13, 2, tzinfo=timezone.utc)
    assert reviewed["first_viewed_at"] == first["first_viewed_at"]

    write_sql = next(query for query, _ in cursor.calls if "INSERT INTO paper_marks" in query)
    assert "first_viewed_at = COALESCE(paper_marks.first_viewed_at, EXCLUDED.first_viewed_at)" in write_sql
    assert "RETURNING paper_id, viewed, liked, favorited" in write_sql


def test_get_paper_marks_returns_first_viewed_at(monkeypatch):
    first_viewed_at = datetime(2026, 7, 1, 2, tzinfo=timezone.utc)
    cursor = OverviewCursor(
        [[{
            "paper_id": "synthetic-paper",
            "viewed": False,
            "liked": False,
            "favorited": False,
            "first_viewed_at": first_viewed_at,
            "viewed_at": None,
            "liked_at": None,
            "favorited_at": None,
            "updated_at": datetime(2026, 7, 2, 2, tzinfo=timezone.utc),
        }]]
    )
    install_fake_connection(monkeypatch, cursor)

    marks = database.get_paper_marks("synthetic-user", ["synthetic-paper"])

    assert marks["synthetic-paper"]["first_viewed_at"] == first_viewed_at
    assert marks["synthetic-paper"]["viewed"] is False
    assert "first_viewed_at" in cursor.calls[0][0]


class MarkedListCursor:
    def __init__(self, item):
        self.item = item
        self.calls = []
        self.call_number = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))
        self.call_number += 1

    def fetchall(self):
        return [self.item]

    def fetchone(self):
        return {"total": 1}


def test_list_marked_papers_returns_first_viewed_at(monkeypatch):
    first_viewed_at = datetime(2026, 7, 1, 2, tzinfo=timezone.utc)
    cursor = MarkedListCursor(
        {
            "id": "synthetic-paper",
            "title": "Synthetic Paper",
            "abstract": "Synthetic abstract",
            "keywords": [],
            "pdf": None,
            "venue": "ACL 2026 Long",
            "primary_area": "Synthetic",
            "llm_response": None,
            "created_at": datetime(2026, 6, 1, tzinfo=timezone.utc),
            "viewed": True,
            "liked": False,
            "favorited": False,
            "first_viewed_at": first_viewed_at,
            "viewed_at": first_viewed_at,
            "liked_at": None,
            "favorited_at": None,
            "mark_updated_at": first_viewed_at,
        }
    )
    install_fake_connection(monkeypatch, cursor)
    monkeypatch.setattr(database, "_load_keywords_for_papers", lambda papers: (papers, True))

    items, total = database.list_marked_papers("synthetic-user", "all", "viewed_at", 0, 12)

    assert total == 1
    assert items[0]["mark"]["first_viewed_at"] == first_viewed_at
    assert "pm.first_viewed_at" in cursor.calls[0][0]


class AnonymousMigrationCursor:
    def __init__(self):
        self.calls = []
        self.pending = None
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))
        if "SELECT 1 FROM papers" in query:
            self.pending = {"exists": 1}
        else:
            self.pending = None

    def fetchone(self):
        return self.pending


def test_anonymous_migration_creates_first_event_without_overwriting_it(monkeypatch):
    cursor = AnonymousMigrationCursor()
    install_fake_connection(monkeypatch, cursor)

    result = database.migrate_anonymous_data(
        "synthetic-user",
        None,
        {"synthetic-paper": {"liked": True}},
    )

    assert result == {"sessions": 0, "marks": 1}
    insert_sql, insert_params = next(
        (query, params) for query, params in cursor.calls if "INSERT INTO paper_marks" in query
    )
    assert "first_viewed_at" in insert_sql
    assert "first_viewed_at = COALESCE(paper_marks.first_viewed_at, EXCLUDED.first_viewed_at)" in insert_sql
    assert insert_params == (
        "synthetic-user",
        "synthetic-paper",
        True,
        True,
        False,
        True,
        True,
        True,
        False,
    )


def test_reading_activity_migration_backfills_indexes_and_enforces_immutability():
    migration = (
        Path(__file__).resolve().parents[1] / "db" / "migrations" / "020_reading_activity.sql"
    ).read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ" in migration
    assert "SET first_viewed_at = viewed_at" in migration
    assert "WHERE first_viewed_at IS NULL" in migration
    assert "idx_paper_marks_user_first_viewed_at" in migration
    assert "WHERE first_viewed_at IS NOT NULL" in migration
    assert "NEW.first_viewed_at := OLD.first_viewed_at" in migration


def test_reading_overview_endpoint_uses_session_user_and_clamps_days(monkeypatch):
    calls = []

    def fake_get_reading_overview(user_id, days):
        calls.append((user_id, days))
        return {"ok": True}

    monkeypatch.setattr(app_module, "get_reading_overview", fake_get_reading_overview)

    assert asyncio.run(
        app_module.my_reading_overview(days=1, user={"id": "session-user-id"})
    ) == {"ok": True}
    assert asyncio.run(
        app_module.my_reading_overview(days=1000, user={"id": "session-user-id"})
    ) == {"ok": True}
    assert calls == [("session-user-id", 28), ("session-user-id", 366)]

    operation = app_module.app.openapi()["paths"]["/me/reading-overview"]["get"]
    assert [parameter["name"] for parameter in operation["parameters"]] == ["days"]
    route = next(route for route in app_module.app.routes if route.path == "/me/reading-overview")
    assert [dependency.call for dependency in route.dependant.dependencies] == [
        app_module.require_current_user
    ]
