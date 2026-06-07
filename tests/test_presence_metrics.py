import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import database


class FakeCursor:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, params=None):
        self.calls.append((query, params))

    def fetchall(self):
        return [
            {
                "bucket_at": datetime(2026, 6, 8, 12, tzinfo=timezone.utc),
                "total_count": 2,
                "authenticated_count": 2,
                "guest_count": 0,
            }
        ]


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_instance = cursor

    def cursor(self):
        return self.cursor_instance


def test_get_presence_trend_buckets_24h_snapshots_by_peak(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "_get_connection", fake_get_connection)

    trend = database.get_presence_trend("24h")

    assert trend == [
        {
            "bucket_at": datetime(2026, 6, 8, 12, tzinfo=timezone.utc),
            "count": 2,
            "authenticated_count": 2,
            "guest_count": 0,
        }
    ]

    trend_sql, params = cursor.calls[0]
    assert "date_bin(%s::interval" in trend_sql
    assert "ROW_NUMBER() OVER" in trend_sql
    assert "PARTITION BY trend_bucket_at" in trend_sql
    assert "ORDER BY total_count DESC, snapshot_at DESC" in trend_sql
    assert params[0] == "30 minutes"


def test_get_presence_trend_uses_coarser_buckets_for_7d(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_get_connection():
        yield FakeConnection(cursor)

    monkeypatch.setattr(database, "_get_connection", fake_get_connection)

    database.get_presence_trend("7d")

    assert cursor.calls[0][1][0] == "6 hours"
