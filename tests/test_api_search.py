"""Tests for the external paper search API (keys, quotas, rate limits, counting)."""

import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import api_search
import database
from api_search import (
    SlidingWindowRateLimiter,
    build_key_hint,
    effective_limits,
    generate_api_key,
    hash_api_key,
    seconds_until_daily_reset,
)
from database import DatabaseError


# ---------------------------------------------------------------------------
# api_search helpers
# ---------------------------------------------------------------------------

def test_generate_api_key_format():
    key = generate_api_key()
    assert key.startswith("pi_")
    assert len(key) > 20
    assert generate_api_key() != key


def test_hash_and_hint_never_expose_full_key():
    key = generate_api_key()
    digest = hash_api_key(key)
    assert digest != key and key not in digest
    assert len(digest) == 64  # sha256 hex
    hint = build_key_hint(key)
    assert hint.startswith("pi_")
    assert hint.endswith(key[-4:])
    assert "..." in hint
    assert key not in hint


def test_rate_limiter_allows_up_to_limit_then_blocks():
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    assert all(limiter.check_and_record("u", 3, now=100.0) for _ in range(3))
    assert not limiter.check_and_record("u", 3, now=100.5)
    assert limiter.retry_after("u", now=100.5) > 0


def test_rate_limiter_window_slides():
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    for _ in range(3):
        limiter.check_and_record("u", 3, now=100.0)
    assert not limiter.check_and_record("u", 3, now=110.0)
    # Oldest hit (t=100) left the window at t=161.
    assert limiter.check_and_record("u", 3, now=161.0)


def test_rate_limiter_users_are_independent():
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    assert limiter.check_and_record("a", 1, now=100.0)
    assert not limiter.check_and_record("a", 1, now=100.5)
    assert limiter.check_and_record("b", 1, now=100.5)


def test_effective_limits_prefer_overrides(monkeypatch):
    monkeypatch.setattr(api_search, "_default_rpm_limit", 20)
    monkeypatch.setattr(api_search, "_default_daily_limit", 1000)
    assert effective_limits(None) == (20, 1000)
    assert effective_limits({"rpm_limit": None, "daily_limit": None}) == (20, 1000)
    assert effective_limits({"rpm_limit": 5, "daily_limit": None}) == (5, 1000)
    assert effective_limits({"rpm_limit": None, "daily_limit": 42}) == (20, 42)


def test_seconds_until_daily_reset_at_beijing_midnight():
    beijing = ZoneInfo("Asia/Shanghai")
    just_before = datetime(2026, 8, 13, 23, 59, 30, tzinfo=beijing)
    assert seconds_until_daily_reset(just_before) == 30
    just_after = datetime(2026, 8, 14, 0, 0, 10, tzinfo=beijing)
    assert seconds_until_daily_reset(just_after) == 86390


# ---------------------------------------------------------------------------
# SQL layer (fake connections, existing test conventions)
# ---------------------------------------------------------------------------

class FakeCursor:
    """Each queued result batch is consumed by exactly one fetchone/fetchall."""

    def __init__(self, results=None):
        self.queries = []
        self.params = []
        self._batches = [list(batch) if isinstance(batch, list) else [batch] for batch in (results or [])]

    def execute(self, query, params=None):
        self.queries.append(query)
        self.params.append(params)
        return self

    def _next_batch(self):
        return self._batches.pop(0) if self._batches else []

    def fetchone(self):
        batch = self._next_batch()
        return batch[0] if batch else None

    def fetchall(self):
        return self._next_batch()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _patch_connection(monkeypatch, cursor):
    from contextlib import contextmanager

    conn = FakeConnection(cursor)

    @contextmanager
    def fake_get_connection():
        yield conn

    monkeypatch.setattr(database, "_get_connection", fake_get_connection)
    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://test/paper_online")
    return conn


def test_reserve_usage_increments_with_guard(monkeypatch):
    cursor = FakeCursor(results=[{"search_count": 128}])
    conn = _patch_connection(monkeypatch, cursor)

    result = database.reserve_api_search_usage("u1", __import__("datetime").date(2026, 8, 13), 1000, "k1")

    assert result == 128
    reserve_sql = cursor.queries[0]
    assert "ON CONFLICT (user_id, usage_date) DO UPDATE" in reserve_sql
    assert "WHERE api_usage_daily.search_count < %s" in reserve_sql
    assert "last_used_at" in cursor.queries[1]
    assert conn.committed is True


def test_reserve_usage_returns_none_when_exhausted(monkeypatch):
    cursor = FakeCursor(results=[None])  # guard rejected the upsert
    _patch_connection(monkeypatch, cursor)

    result = database.reserve_api_search_usage("u1", __import__("datetime").date(2026, 8, 13), 1000, "k1")

    assert result is None
    assert len(cursor.queries) == 1  # no last_used_at stamp on a blocked request


def test_create_api_key_revokes_previous_first(monkeypatch):
    cursor = FakeCursor(
        results=[{"id": "new", "user_id": "u1", "key_hint": "pi_ab...cd", "status": "active",
                  "created_at": None, "last_used_at": None}]
    )
    conn = _patch_connection(monkeypatch, cursor)

    row = database.create_api_key("u1", "hash", "pi_ab...cd")

    assert row["id"] == "new"
    assert "SET status = 'revoked'" in cursor.queries[0]
    assert "INSERT INTO api_keys" in cursor.queries[1]
    assert conn.committed is True


def test_api_search_papers_maps_rows(monkeypatch):
    cursor = FakeCursor(
        results=[
            [{"id": "p1", "title": "T", "abstract": "A", "venue": "V", "code_status": None,
              "authors": ["Alice", "Bob"], "keywords": ["llm"]}],
            [{"total": 7}],
        ]
    )
    _patch_connection(monkeypatch, cursor)

    papers, total = database.api_search_papers("llm", None, "all", 10, 0)

    assert total == 7
    assert papers == [
        {"id": "p1", "title": "T", "abstract": "A", "venue": "V", "code_status": "unknown",
         "authors": ["Alice", "Bob"], "keywords": ["llm"]}
    ]
    assert "search_papers_api(%s, %s, %s, %s, %s)" in cursor.queries[0]
    assert "count_papers_optimized(%s, %s, TRUE, TRUE, TRUE, %s)" in cursor.queries[1]


def test_set_user_api_quota_deletes_when_all_defaults(monkeypatch):
    cursor = FakeCursor()
    _patch_connection(monkeypatch, cursor)

    database.set_user_api_quota("u1", None, None)

    assert "DELETE FROM user_api_quotas" in cursor.queries[0]


def test_list_api_search_users_escapes_ilike_for_psycopg(monkeypatch):
    cursor = FakeCursor(results=[[{"total": 0}], []])
    _patch_connection(monkeypatch, cursor)

    database.list_api_search_users("a@b", 0, 10, __import__("datetime").date(2026, 8, 13), "u1")

    # psycopg3 requires literal % in SQL text to be doubled.
    for query in cursor.queries:
        assert "'%%' || %s || '%%'" in query
        assert "'%' ||" not in query


# ---------------------------------------------------------------------------
# Endpoints (TestClient with monkeypatched database functions)
# ---------------------------------------------------------------------------

ADMIN_USER = {"id": "admin-1", "email": "admin@example.com", "role": "admin", "is_active": True}
NORMAL_USER = {"id": "user-1", "email": "a@b.com", "role": "user", "is_active": True}


class ApiSearchEndpoints:
    """Fake database layer for endpoint tests."""

    def __init__(self, rpm_limit=None, daily_limit=None):
        self.owner = {"id": "key-1", "user_id": "user-1"}
        self.quota = {"rpm_limit": rpm_limit, "daily_limit": daily_limit}
        self.usage = 0
        self.reserve_calls = 0
        self.release_calls = 0
        self.search_calls = 0
        self.search_result = ([], 0)
        self.search_error = None
        self.reserve_result = "auto"
        self.created_keys = []
        self.key = {
            "id": "key-1", "user_id": "user-1", "key_hint": "pi_ab12...9f8e",
            "status": "active", "created_at": None, "last_used_at": None,
        }
        self.status_updates = []
        self.users = []

    # database functions imported into app namespace
    def get_api_key_owner_by_hash(self, key_hash):
        if self.owner and key_hash == hash_api_key(self.current_raw_key):
            return self.owner
        return None

    current_raw_key = None

    def get_user_api_quota(self, user_id):
        return self.quota

    def reserve_api_search_usage(self, user_id, usage_date, daily_limit, key_id):
        self.reserve_calls += 1
        if self.reserve_result == "auto":
            self.usage += 1
            return self.usage
        return self.reserve_result

    def release_api_search_usage(self, user_id, usage_date):
        self.release_calls += 1

    def api_search_papers(self, search, venue_prefix, code_filter, limit, offset):
        self.search_calls += 1
        if self.search_error:
            raise self.search_error
        return self.search_result

    def get_user_api_key(self, user_id):
        return self.key

    def get_api_search_usage(self, user_id, usage_date):
        return self.usage

    def create_api_key(self, user_id, key_hash, key_hint):
        self.current_raw_key = self.last_generated_raw
        self.created_keys.append(key_hash)
        self.key = {**self.key, "key_hint": key_hint}
        return self.key

    last_generated_raw = None

    def set_api_key_status(self, user_id, status):
        self.status_updates.append(status)
        self.key = {**self.key, "status": status}
        return self.key

    def get_user_by_id(self, user_id):
        return NORMAL_USER if user_id == "user-1" else ADMIN_USER

    def set_user_api_quota(self, user_id, rpm_limit, daily_limit):
        self.quota_calls = getattr(self, "quota_calls", [])
        self.quota_calls.append((user_id, rpm_limit, daily_limit))
        return {"user_id": user_id, "rpm_limit": rpm_limit, "daily_limit": daily_limit}

    def list_api_search_users(self, search, offset, limit, usage_date, user_id=None):
        if user_id:
            return (self.users or [], 0)
        return (self.users or [], len(self.users or []))


@pytest.fixture()
def endpoints(monkeypatch):
    import app as app_module
    from fastapi.testclient import TestClient

    fake = ApiSearchEndpoints()
    raw_key = generate_api_key()
    fake.current_raw_key = raw_key

    for name in (
        "get_api_key_owner_by_hash",
        "get_user_api_quota",
        "reserve_api_search_usage",
        "release_api_search_usage",
        "api_search_papers",
        "get_user_api_key",
        "get_api_search_usage",
        "create_api_key",
        "set_api_key_status",
        "get_user_by_id",
        "set_user_api_quota",
        "list_api_search_users",
    ):
        monkeypatch.setattr(app_module, name, getattr(fake, name))

    monkeypatch.setattr(app_module, "get_user_by_session_token_hash", lambda token: NORMAL_USER)
    monkeypatch.setattr(app_module, "api_rate_limiter", SlidingWindowRateLimiter())
    # Track generated raw keys so the fake owner lookup can validate them.
    original_generate = app_module.generate_api_key

    def tracked_generate():
        raw = original_generate()
        fake.last_generated_raw = raw
        return raw

    monkeypatch.setattr(app_module, "generate_api_key", tracked_generate)

    client = TestClient(app_module.app)
    client.headers.update({"Authorization": f"Bearer {raw_key}"})
    # /me/* endpoints authenticate via the session cookie, not the Bearer key.
    client.cookies.set("paper_session", "user-session-token")
    fake.client = client
    fake.raw_key = raw_key
    return fake


def _search(fake, **params):
    base = {"q": "llm"}
    base.update(params)
    return fake.client.get("/api/v1/papers/search", params=base)


def test_api_search_requires_bearer_key(endpoints):
    endpoints.client.headers.pop("Authorization")
    response = _search(endpoints)
    assert response.status_code == 401
    assert response.json()["detail"] == "缺少有效的 Authorization 请求头，格式为：Authorization: Bearer <API Key>"


def test_api_search_rejects_invalid_key_without_counting(endpoints):
    endpoints.client.headers.update({"Authorization": "Bearer pi_definitely_wrong"})
    response = _search(endpoints)
    assert response.status_code == 401
    assert response.json()["detail"] == "无效的 API Key"
    assert endpoints.reserve_calls == 0


def test_api_search_validates_params_without_counting(endpoints):
    for params in (
        {"q": "   "},
        {"q": "x", "venue": "nips_2030"},
        {"q": "x", "code_status": "closed"},
        {"q": "x", "page": 0},
        {"q": "x", "limit": 101},
        {"q": "x", "limit": 0},
    ):
        response = _search(endpoints, **params)
        assert response.status_code == 400, params
        assert endpoints.reserve_calls == 0, params
        assert endpoints.search_calls == 0, params


def test_api_search_success_counts_and_shapes_response(endpoints):
    endpoints.search_result = (
        [
            {
                "id": "p1", "title": "T", "abstract": "A", "venue": "NeurIPS 2025",
                "code_status": "open_source", "authors": ["Alice"], "keywords": ["llm"],
            }
        ],
        25,
    )
    response = _search(endpoints, q="llm", venue="neurips_2025", code_status="open_source", page=2, limit=10)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 25
    assert body["page"] == 2
    assert body["pages"] == 3
    assert body["papers"][0]["url"].endswith("/papers/p1")
    assert body["usage"] == {"today_used": 1, "daily_limit": 1000, "rpm_limit": 20}
    assert endpoints.reserve_calls == 1
    assert endpoints.search_calls == 1


def test_api_search_empty_results_still_count(endpoints):
    endpoints.search_result = ([], 0)
    response = _search(endpoints)
    assert response.status_code == 200
    assert response.json()["papers"] == []
    assert endpoints.reserve_calls == 1


def test_api_search_rpm_limit_blocks_21st_style_request(endpoints):
    endpoints.quota = {"rpm_limit": 3, "daily_limit": 1000}
    for _ in range(3):
        assert _search(endpoints).status_code == 200
    blocked = _search(endpoints)
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "请求太频繁，请稍后再试。"
    assert "Retry-After" in blocked.headers
    # Blocked requests must not reach the daily counter or the search.
    assert endpoints.reserve_calls == 3
    assert endpoints.search_calls == 3


def test_api_search_daily_limit_blocks_and_does_not_count(endpoints):
    endpoints.reserve_result = None  # atomic reserve says quota exhausted
    response = _search(endpoints)
    assert response.status_code == 429
    assert response.json()["detail"] == "今天的 API 搜索额度已经用完。"
    assert "Retry-After" in response.headers
    assert endpoints.search_calls == 0


def test_api_search_server_error_refunds_usage(endpoints):
    endpoints.search_error = DatabaseError("boom")
    response = _search(endpoints)
    assert response.status_code == 502
    assert endpoints.release_calls == 1


def test_me_api_key_flow(endpoints):
    get_response = endpoints.client.get("/me/api-key")
    assert get_response.status_code == 200
    assert get_response.json()["api_key"]["key_hint"].startswith("pi_")
    assert "key" not in get_response.json()["api_key"]  # full key never returned by GET

    create_response = endpoints.client.post("/me/api-key")
    assert create_response.status_code == 200
    created = create_response.json()["api_key"]
    assert created["key"].startswith("pi_")  # shown exactly once
    assert created["key_hint"] == build_key_hint(created["key"])
    assert len(endpoints.created_keys) == 1
    assert endpoints.created_keys[0] == hash_api_key(created["key"])

    disable_response = endpoints.client.post("/me/api-key/disable")
    assert disable_response.status_code == 200
    assert endpoints.status_updates == ["disabled"]


def test_regenerated_key_invalidates_old_one(endpoints):
    old_key = endpoints.raw_key
    created = endpoints.client.post("/me/api-key").json()["api_key"]["key"]
    # The fake owner now only accepts the new key.
    endpoints.client.headers.update({"Authorization": f"Bearer {old_key}"})
    assert _search(endpoints).status_code == 401
    endpoints.client.headers.update({"Authorization": f"Bearer {created}"})
    assert _search(endpoints).status_code == 200


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@pytest.fixture()
def admin_client(monkeypatch):
    import app as app_module
    from fastapi.testclient import TestClient

    fake = ApiSearchEndpoints()
    for name in (
        "get_user_by_id",
        "set_user_api_quota",
        "set_api_key_status",
        "list_api_search_users",
        "get_user_api_key",
        "get_user_api_quota",
        "get_api_search_usage",
    ):
        monkeypatch.setattr(app_module, name, getattr(fake, name))
    # Never touch the real config.yaml in tests.
    monkeypatch.setattr(app_module, "write_api_search_config", lambda rpm, daily: None)
    monkeypatch.setattr(app_module, "apply_default_limits", lambda rpm, daily: None)
    monkeypatch.setattr(app_module, "get_user_by_session_token_hash", lambda token: ADMIN_USER)
    fake.users = [
        {
            "id": "user-1", "email": "a@b.com", "role": "user", "is_active": True,
            "key_hint": "pi_ab12...9f8e", "key_status": "active",
            "key_created_at": None, "key_last_used_at": None,
            "rpm_limit": None, "daily_limit": 500, "today_used": 12,
        }
    ]
    client = TestClient(app_module.app)
    client.cookies.set("paper_session", "admin-session-token")
    fake.client = client
    return fake


def test_admin_list_api_search_users_attaches_effective_limits(admin_client):
    response = admin_client.client.get("/admin/api-search/users")
    assert response.status_code == 200
    body = response.json()
    user = body["users"][0]
    assert user["effective_rpm_limit"] == 20  # no override -> global default
    assert user["effective_daily_limit"] == 500  # override wins
    assert user["today_used"] == 12
    assert body["defaults"]["default_rpm_limit"] == 20


def test_admin_update_settings_validation(admin_client):
    response = admin_client.client.put(
        "/admin/api-search/settings", json={"default_rpm_limit": 0, "default_daily_limit": 1000}
    )
    assert response.status_code == 400


def test_admin_update_user_quotas_and_key(admin_client):
    response = admin_client.client.patch(
        "/admin/api-search/users/user-1",
        json={"rpm_limit": 60, "daily_limit": 2000, "key_status": "disabled"},
    )
    assert response.status_code == 200
    assert admin_client.quota_calls[-1] == ("user-1", 60, 2000)
    assert admin_client.status_updates == ["disabled"]


def test_admin_clear_quota_override_with_explicit_null(admin_client):
    admin_client.quota = {"rpm_limit": 60, "daily_limit": 500}
    response = admin_client.client.patch(
        "/admin/api-search/users/user-1",
        json={"daily_limit": None},
    )
    assert response.status_code == 200
    # Explicit null clears only daily_limit; rpm override untouched.
    assert admin_client.quota_calls[-1] == ("user-1", 60, None)


def test_admin_cannot_enable_missing_key(admin_client, monkeypatch):
    import app as app_module

    admin_client.key = None
    monkeypatch.setattr(
        app_module, "set_api_key_status", lambda user_id, status: None
    )
    response = admin_client.client.patch(
        "/admin/api-search/users/user-1", json={"key_status": "active"}
    )
    assert response.status_code == 400
    assert "没有可启用" in response.json()["detail"]


def test_admin_endpoints_require_admin_role(monkeypatch):
    import app as app_module
    from fastapi.testclient import TestClient

    monkeypatch.setattr(app_module, "get_user_by_session_token_hash", lambda token: NORMAL_USER)
    client = TestClient(app_module.app)
    client.cookies.set("paper_session", "normal-session-token")
    assert client.get("/admin/api-search/users").status_code == 403
