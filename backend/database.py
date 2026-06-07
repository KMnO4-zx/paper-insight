import logging
import re
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterator, TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from config import settings
from utils import get_openreview_pdf_url, normalize_paper_pdf_url

DATABASE_URL = settings.database.url

logger = logging.getLogger(__name__)
T = TypeVar("T")

# Cache for conference/search results
_conference_cache = {}
_cache_timestamp = {}
_CACHE_TTL_SECONDS = 86400


class DatabaseError(Exception):
    """Raised when database access fails after retries."""


def _normalize_user_row(row: dict | None) -> dict | None:
    if not row:
        return None
    normalized = dict(row)
    normalized["id"] = str(normalized["id"])
    return normalized


def _normalize_session_row(row: dict | None) -> dict | None:
    if not row:
        return None
    normalized = dict(row)
    if normalized.get("account_user_id") is not None:
        normalized["account_user_id"] = str(normalized["account_user_id"])
    return normalized


def _normalize_feishu_settings_row(row: dict | None) -> dict | None:
    if not row:
        return None
    normalized = dict(row)
    normalized["user_id"] = str(normalized["user_id"])
    return normalized


def _normalize_llm_provider_row(row: dict | None) -> dict | None:
    if not row:
        return None
    normalized = dict(row)
    normalized["id"] = str(normalized["id"])
    return normalized


def _normalize_llm_model_row(row: dict | None) -> dict | None:
    if not row:
        return None
    normalized = dict(row)
    normalized["id"] = str(normalized["id"])
    normalized["provider_id"] = str(normalized["provider_id"])
    return normalized


def _run_with_retry(
    operation: Callable[[], T],
    context: str,
    retries: int = 3,
    delay: float = 1.0,
) -> T:
    last_error: Exception | None = None

    for attempt in range(retries):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Database operation failed for %s (attempt %s/%s): %s",
                context,
                attempt + 1,
                retries,
                exc,
            )
            if attempt < retries - 1:
                time.sleep(delay)

    raise DatabaseError(f"Database operation failed for {context}") from last_error


@contextmanager
def _get_connection() -> Iterator[psycopg.Connection]:
    if not DATABASE_URL:
        raise DatabaseError("DATABASE_URL is not configured")

    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


def _fetch_keywords_for_papers(conn: psycopg.Connection, paper_ids: list[str]) -> dict[str, list[str]]:
    if not paper_ids:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT paper_id, keyword
            FROM keywords
            WHERE paper_id = ANY(%s)
            ORDER BY id
            """,
            (paper_ids,),
        )
        rows = cur.fetchall()

    keywords_by_paper: dict[str, list[str]] = {}
    for row in rows:
        keywords_by_paper.setdefault(row["paper_id"], []).append(row["keyword"])
    return keywords_by_paper


def get_paper(paper_id: str) -> dict | None:
    if not DATABASE_URL:
        return None

    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM papers WHERE id = %s", (paper_id,))
                paper = cur.fetchone()
                if not paper:
                    return None

                cur.execute(
                    """
                    SELECT author_name
                    FROM authors
                    WHERE paper_id = %s
                    ORDER BY author_order
                    """,
                    (paper_id,),
                )
                paper["authors"] = [row["author_name"] for row in cur.fetchall()]

                cur.execute(
                    """
                    SELECT keyword
                    FROM keywords
                    WHERE paper_id = %s
                    ORDER BY id
                    """,
                    (paper_id,),
                )
                paper["keywords"] = [row["keyword"] for row in cur.fetchall()]
                paper["pdf"] = normalize_paper_pdf_url(paper_id, paper.get("pdf")) or get_openreview_pdf_url(paper_id)
                return paper

    return _run_with_retry(operation, f"get_paper:{paper_id}")


def save_paper(paper_info: dict, llm_response: str = None):
    if not DATABASE_URL:
        return

    def operation() -> None:
        normalized_pdf = normalize_paper_pdf_url(paper_info["id"], paper_info.get("pdf"))
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO papers (
                        id,
                        title,
                        abstract,
                        keywords,
                        pdf,
                        venue,
                        primary_area,
                        llm_response
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        abstract = EXCLUDED.abstract,
                        keywords = EXCLUDED.keywords,
                        pdf = EXCLUDED.pdf,
                        venue = EXCLUDED.venue,
                        primary_area = EXCLUDED.primary_area,
                        llm_response = EXCLUDED.llm_response
                    """,
                    (
                        paper_info["id"],
                        paper_info.get("title"),
                        paper_info.get("abstract"),
                        Jsonb(paper_info.get("keywords", [])),
                        normalized_pdf,
                        paper_info.get("venue"),
                        paper_info.get("primary_area"),
                        llm_response,
                    ),
                )

                cur.execute("DELETE FROM authors WHERE paper_id = %s", (paper_info["id"],))
                authors = paper_info.get("authors", [])
                if authors:
                    cur.executemany(
                        """
                        INSERT INTO authors (paper_id, author_name, author_order)
                        VALUES (%s, %s, %s)
                        """,
                        [
                            (paper_info["id"], author, index)
                            for index, author in enumerate(authors)
                        ],
                    )

                cur.execute("DELETE FROM keywords WHERE paper_id = %s", (paper_info["id"],))
                keywords = paper_info.get("keywords", [])
                if keywords:
                    cur.executemany(
                        """
                        INSERT INTO keywords (paper_id, keyword)
                        VALUES (%s, %s)
                        """,
                        [(paper_info["id"], keyword) for keyword in keywords],
                    )

            conn.commit()

    _run_with_retry(operation, f"save_paper:{paper_info['id']}")


def upsert_hf_daily_papers(daily_date: date, entries: list[dict]) -> list[str]:
    if not DATABASE_URL or not entries:
        return []

    def operation() -> list[str]:
        analyzable_paper_ids: list[str] = []
        selected_paper_ids: list[str] = [entry["paper"]["id"] for entry in entries]
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM hf_daily_papers
                    WHERE daily_date = %s
                      AND paper_id <> ALL(%s)
                    """,
                    (daily_date, selected_paper_ids),
                )

                for entry in entries:
                    paper_info = entry["paper"]
                    daily_info = entry["daily"]
                    paper_id = paper_info["id"]
                    normalized_pdf = normalize_paper_pdf_url(paper_id, paper_info.get("pdf"))

                    cur.execute(
                        """
                        INSERT INTO papers (
                            id,
                            title,
                            abstract,
                            keywords,
                            pdf,
                            venue,
                            primary_area
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            title = EXCLUDED.title,
                            abstract = EXCLUDED.abstract,
                            keywords = EXCLUDED.keywords,
                            pdf = EXCLUDED.pdf,
                            venue = EXCLUDED.venue,
                            primary_area = EXCLUDED.primary_area
                        RETURNING llm_response
                        """,
                        (
                            paper_id,
                            paper_info.get("title"),
                            paper_info.get("abstract"),
                            Jsonb(paper_info.get("keywords", [])),
                            normalized_pdf,
                            paper_info.get("venue"),
                            paper_info.get("primary_area"),
                        ),
                    )
                    paper_row = cur.fetchone()
                    if not paper_row or not paper_row.get("llm_response"):
                        analyzable_paper_ids.append(paper_id)

                    cur.execute("DELETE FROM authors WHERE paper_id = %s", (paper_id,))
                    authors = paper_info.get("authors", [])
                    if authors:
                        cur.executemany(
                            """
                            INSERT INTO authors (paper_id, author_name, author_order)
                            VALUES (%s, %s, %s)
                            """,
                            [
                                (paper_id, author, index)
                                for index, author in enumerate(authors)
                            ],
                        )

                    cur.execute("DELETE FROM keywords WHERE paper_id = %s", (paper_id,))
                    keywords = paper_info.get("keywords", [])
                    if keywords:
                        cur.executemany(
                            """
                            INSERT INTO keywords (paper_id, keyword)
                            VALUES (%s, %s)
                            """,
                            [(paper_id, keyword) for keyword in keywords],
                        )

                    cur.execute(
                        """
                        INSERT INTO hf_daily_papers (
                            daily_date,
                            paper_id,
                            rank,
                            upvotes,
                            thumbnail,
                            discussion_id,
                            project_page,
                            github_repo,
                            github_stars,
                            num_comments,
                            raw
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (daily_date, paper_id) DO UPDATE SET
                            rank = EXCLUDED.rank,
                            upvotes = EXCLUDED.upvotes,
                            thumbnail = EXCLUDED.thumbnail,
                            discussion_id = EXCLUDED.discussion_id,
                            project_page = EXCLUDED.project_page,
                            github_repo = EXCLUDED.github_repo,
                            github_stars = EXCLUDED.github_stars,
                            num_comments = EXCLUDED.num_comments,
                            raw = EXCLUDED.raw,
                            updated_at = NOW()
                        """,
                        (
                            daily_date,
                            paper_id,
                            daily_info["rank"],
                            daily_info.get("upvotes", 0),
                            daily_info.get("thumbnail"),
                            daily_info.get("discussion_id"),
                            daily_info.get("project_page"),
                            daily_info.get("github_repo"),
                            daily_info.get("github_stars"),
                            daily_info.get("num_comments"),
                            Jsonb(daily_info.get("raw", {})),
                        ),
                    )

            conn.commit()

        _conference_cache.clear()
        _cache_timestamp.clear()
        return analyzable_paper_ids

    return _run_with_retry(operation, f"upsert_hf_daily_papers:{daily_date.isoformat()}")


def update_llm_response(paper_id: str, response: str):
    if not DATABASE_URL:
        return

    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE papers
                    SET llm_response = %s
                    WHERE id = %s
                    """,
                    (response, paper_id),
                )
            conn.commit()

    _run_with_retry(operation, f"update_llm_response:{paper_id}")


def create_user(
    email: str,
    email_normalized: str,
    password_hash: str | None,
    role: str = "user",
    email_verified: bool = False,
) -> dict:
    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (email, email_normalized, password_hash, role, email_verified)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (email, email_normalized, password_hash, role, email_verified),
                )
                user = cur.fetchone()
            conn.commit()
        return _normalize_user_row(user)

    return _run_with_retry(operation, f"create_user:{email_normalized}")


def create_or_link_github_user(
    email: str,
    email_normalized: str,
    provider_user_id: str,
    provider_username: str,
    display_name: str | None = None,
    avatar_url: str | None = None,
) -> tuple[dict | None, str | None]:
    def operation() -> tuple[dict | None, str | None]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT users.*
                    FROM auth_identities
                    JOIN users ON users.id = auth_identities.user_id
                    WHERE auth_identities.provider = 'github'
                      AND auth_identities.provider_user_id = %s
                    """,
                    (provider_user_id,),
                )
                existing_identity_user = cur.fetchone()
                if existing_identity_user:
                    cur.execute(
                        """
                        UPDATE auth_identities
                        SET provider_username = %s,
                            provider_email = %s,
                            display_name = %s,
                            avatar_url = %s,
                            updated_at = NOW(),
                            last_login_at = NOW()
                        WHERE provider = 'github'
                          AND provider_user_id = %s
                        """,
                        (provider_username, email, display_name, avatar_url, provider_user_id),
                    )
                    conn.commit()
                    return _normalize_user_row(existing_identity_user), None

                cur.execute(
                    """
                    SELECT *
                    FROM users
                    WHERE email_normalized = %s
                    FOR UPDATE
                    """,
                    (email_normalized,),
                )
                user = cur.fetchone()
                if user:
                    cur.execute(
                        """
                        SELECT provider_user_id
                        FROM auth_identities
                        WHERE provider = 'github'
                          AND user_id = %s
                        FOR UPDATE
                        """,
                        (user["id"],),
                    )
                    linked_identity = cur.fetchone()
                    if linked_identity and linked_identity["provider_user_id"] != provider_user_id:
                        return None, "email_linked_to_different_github"

                    cur.execute(
                        """
                        UPDATE users
                        SET email_verified = TRUE,
                            updated_at = NOW()
                        WHERE id = %s
                        RETURNING *
                        """,
                        (user["id"],),
                    )
                    user = cur.fetchone()
                else:
                    cur.execute(
                        """
                        INSERT INTO users (email, email_normalized, password_hash, role, email_verified)
                        VALUES (%s, %s, NULL, 'user', TRUE)
                        RETURNING *
                        """,
                        (email, email_normalized),
                    )
                    user = cur.fetchone()

                cur.execute(
                    """
                    INSERT INTO auth_identities (
                      user_id,
                      provider,
                      provider_user_id,
                      provider_username,
                      provider_email,
                      display_name,
                      avatar_url,
                      last_login_at
                    )
                    VALUES (%s, 'github', %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        user["id"],
                        provider_user_id,
                        provider_username,
                        email,
                        display_name,
                        avatar_url,
                    ),
                )
            conn.commit()
        return _normalize_user_row(user), None

    return _run_with_retry(operation, f"create_or_link_github_user:{provider_user_id}")


def get_user_by_email(email_normalized: str) -> dict | None:
    if not DATABASE_URL:
        return None

    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE email_normalized = %s", (email_normalized,))
                return _normalize_user_row(cur.fetchone())

    return _run_with_retry(operation, f"get_user_by_email:{email_normalized}")


def get_user_by_id(user_id: str) -> dict | None:
    if not DATABASE_URL:
        return None

    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
                return _normalize_user_row(cur.fetchone())

    return _run_with_retry(operation, f"get_user_by_id:{user_id}")


def update_user_password(user_id: str, password_hash: str) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE users
                    SET password_hash = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (password_hash, user_id),
                )
            conn.commit()

    _run_with_retry(operation, f"update_user_password:{user_id}")


def update_user_last_login(user_id: str) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE users
                    SET last_login_at = NOW(), updated_at = NOW()
                    WHERE id = %s
                    """,
                    (user_id,),
                )
            conn.commit()

    _run_with_retry(operation, f"update_user_last_login:{user_id}")


def ensure_admin_user(email: str, email_normalized: str, password_hash: str) -> dict:
    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE email_normalized = %s", (email_normalized,))
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        """
                        UPDATE users
                        SET role = 'admin', is_active = TRUE, updated_at = NOW()
                        WHERE id = %s
                        RETURNING *
                        """,
                        (existing["id"],),
                    )
                    user = cur.fetchone()
                else:
                    cur.execute(
                        """
                        INSERT INTO users (email, email_normalized, password_hash, role, email_verified)
                        VALUES (%s, %s, %s, 'admin', TRUE)
                        RETURNING *
                        """,
                        (email, email_normalized, password_hash),
                    )
                    user = cur.fetchone()
            conn.commit()
        return _normalize_user_row(user)

    return _run_with_retry(operation, f"ensure_admin_user:{email_normalized}")


def create_user_session(
    user_id: str,
    token_hash: str,
    expires_at: datetime,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (user_id, token_hash, expires_at, user_agent, ip_address),
                )
            conn.commit()

    _run_with_retry(operation, f"create_user_session:{user_id}")


def get_user_by_session_token_hash(token_hash: str) -> dict | None:
    if not DATABASE_URL:
        return None

    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT users.*
                    FROM user_sessions
                    JOIN users ON users.id = user_sessions.user_id
                    WHERE user_sessions.token_hash = %s
                      AND user_sessions.revoked_at IS NULL
                      AND user_sessions.expires_at > NOW()
                      AND users.is_active = TRUE
                    """,
                    (token_hash,),
                )
                user = cur.fetchone()
                if user:
                    cur.execute(
                        """
                        UPDATE user_sessions
                        SET last_seen_at = NOW()
                        WHERE token_hash = %s
                        """,
                        (token_hash,),
                    )
                    conn.commit()
                return _normalize_user_row(user)

    return _run_with_retry(operation, "get_user_by_session_token_hash")


def revoke_session(token_hash: str) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE user_sessions
                    SET revoked_at = NOW()
                    WHERE token_hash = %s AND revoked_at IS NULL
                    """,
                    (token_hash,),
                )
            conn.commit()

    _run_with_retry(operation, "revoke_session")


def revoke_user_sessions(user_id: str, except_token_hash: str | None = None) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                if except_token_hash:
                    cur.execute(
                        """
                        UPDATE user_sessions
                        SET revoked_at = NOW()
                        WHERE user_id = %s AND token_hash <> %s AND revoked_at IS NULL
                        """,
                        (user_id, except_token_hash),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE user_sessions
                        SET revoked_at = NOW()
                        WHERE user_id = %s AND revoked_at IS NULL
                        """,
                        (user_id,),
                    )
            conn.commit()

    _run_with_retry(operation, f"revoke_user_sessions:{user_id}")


def count_active_admins() -> int:
    def operation() -> int:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = TRUE")
                row = cur.fetchone()
                return int(row["total"] or 0)

    return _run_with_retry(operation, "count_active_admins")


def list_users(search: str | None, offset: int, limit: int) -> tuple[list[dict], int]:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.presence.online_timeout_seconds)

    def operation() -> tuple[list[dict], int]:
        params: list[object] = []
        where = ""
        if search:
            where = "WHERE u.email ILIKE %s"
            params.append(f"%{search}%")

        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) AS total FROM users u {where}", params)
                total = int(cur.fetchone()["total"] or 0)
                cur.execute(
                    f"""
                    WITH active_presence AS (
                        SELECT user_id, MAX(last_seen_at) AS online_last_seen_at
                        FROM presence_heartbeats
                        WHERE user_id IS NOT NULL
                          AND last_seen_at > %s
                        GROUP BY user_id
                    )
                    SELECT u.id, u.email, u.role, u.is_active, u.email_verified,
                           u.created_at, u.last_login_at,
                           (active_presence.user_id IS NOT NULL) AS is_online,
                           active_presence.online_last_seen_at
                    FROM users u
                    LEFT JOIN active_presence ON active_presence.user_id = u.id
                    {where}
                    ORDER BY
                        (active_presence.user_id IS NOT NULL) DESC,
                        active_presence.online_last_seen_at DESC NULLS LAST,
                        u.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    [cutoff, *params, limit, offset],
                )
                users = [_normalize_user_row(row) for row in cur.fetchall()]
        return users, total

    return _run_with_retry(operation, "list_users")


def update_user_admin_fields(
    user_id: str,
    role: str | None = None,
    is_active: bool | None = None,
) -> dict | None:
    def operation() -> dict | None:
        updates = []
        params: list[object] = []
        if role is not None:
            updates.append("role = %s")
            params.append(role)
        if is_active is not None:
            updates.append("is_active = %s")
            params.append(is_active)
        if not updates:
            return get_user_by_id(user_id)

        params.append(user_id)
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE users
                    SET {", ".join(updates)}, updated_at = NOW()
                    WHERE id = %s
                    RETURNING id, email, role, is_active, email_verified, created_at, last_login_at
                    """,
                    params,
                )
                user = cur.fetchone()
            conn.commit()
        return _normalize_user_row(user)

    return _run_with_retry(operation, f"update_user_admin_fields:{user_id}")


def delete_user(user_id: str) -> bool:
    def operation() -> bool:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM users WHERE id = %s RETURNING id",
                    (user_id,),
                )
                deleted = cur.fetchone() is not None
            conn.commit()
        return deleted

    return _run_with_retry(operation, f"delete_user:{user_id}")


def _normalize_model_names(model_names: list[str] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw_name in model_names or []:
        model_name = str(raw_name or "").strip()
        if not model_name or model_name in seen:
            continue
        seen.add(model_name)
        normalized.append(model_name)
    return normalized


def _provider_key_from_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "custom-provider"


def _unique_llm_provider_key(cur: psycopg.Cursor, name: str) -> str:
    base_key = _provider_key_from_name(name)
    provider_key = base_key
    while True:
        cur.execute("SELECT 1 FROM llm_providers WHERE provider_key = %s", (provider_key,))
        if not cur.fetchone():
            return provider_key
        provider_key = f"{base_key}-{uuid.uuid4().hex[:8]}"


def _fetch_llm_models_for_provider(
    conn: psycopg.Connection,
    provider_ids: list[uuid.UUID],
) -> dict[str, list[dict]]:
    if not provider_ids:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, provider_id, model_name, display_name, is_enabled, source, created_at, updated_at
            FROM llm_models
            WHERE provider_id = ANY(%s)
            ORDER BY model_name
            """,
            (provider_ids,),
        )
        rows = cur.fetchall()

    models_by_provider: dict[str, list[dict]] = {}
    for row in rows:
        model = _normalize_llm_model_row(row)
        models_by_provider.setdefault(model["provider_id"], []).append(model)
    return models_by_provider


def ensure_default_llm_providers(provider_specs: list[dict]) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                for spec in provider_specs:
                    provider_key = spec["provider_key"]
                    name = spec["name"].strip()
                    base_url = spec["base_url"].strip().rstrip("/")
                    api_key = (spec.get("api_key") or "").strip() or None
                    active_model = (spec.get("active_model") or "").strip() or None
                    default_parameters = spec.get("default_parameters") or {}

                    cur.execute(
                        """
                        INSERT INTO llm_providers (
                          provider_key, name, base_url, api_key, is_builtin,
                          active_model, default_parameters
                        )
                        VALUES (%s, %s, %s, %s, TRUE, %s, %s)
                        ON CONFLICT (provider_key) DO UPDATE SET
                          name = EXCLUDED.name,
                          base_url = EXCLUDED.base_url,
                          api_key = CASE
                            WHEN COALESCE(llm_providers.api_key, '') = ''
                              THEN EXCLUDED.api_key
                            ELSE llm_providers.api_key
                          END,
                          is_builtin = TRUE,
                          active_model = COALESCE(NULLIF(llm_providers.active_model, ''), EXCLUDED.active_model),
                          default_parameters = EXCLUDED.default_parameters,
                          updated_at = NOW()
                        RETURNING id
                        """,
                        (
                            provider_key,
                            name,
                            base_url,
                            api_key,
                            active_model,
                            Jsonb(default_parameters),
                        ),
                    )
                    provider_id = cur.fetchone()["id"]

                    for model_name in _normalize_model_names(spec.get("models")):
                        cur.execute(
                            """
                            INSERT INTO llm_models (provider_id, model_name, display_name, source)
                            VALUES (%s, %s, %s, 'seed')
                            ON CONFLICT (provider_id, model_name) DO UPDATE SET
                              display_name = COALESCE(llm_models.display_name, EXCLUDED.display_name),
                              is_enabled = TRUE,
                              updated_at = NOW()
                            """,
                            (provider_id, model_name, model_name),
                        )

                cur.execute("SELECT id FROM llm_providers WHERE is_active AND is_enabled LIMIT 1")
                active = cur.fetchone()
                if not active:
                    cur.execute(
                        """
                        SELECT id
                        FROM llm_providers
                        WHERE is_enabled
                        ORDER BY CASE WHEN provider_key = 'step' THEN 0 ELSE 1 END,
                                 is_builtin DESC,
                                 name
                        LIMIT 1
                        """
                    )
                    selected = cur.fetchone()
                    if selected:
                        cur.execute("UPDATE llm_providers SET is_active = FALSE WHERE is_active")
                        cur.execute(
                            """
                            UPDATE llm_providers
                            SET is_active = TRUE, updated_at = NOW()
                            WHERE id = %s
                            """,
                            (selected["id"],),
                        )
            conn.commit()

    _run_with_retry(operation, "ensure_default_llm_providers")


def list_llm_providers(include_models: bool = True) -> list[dict]:
    def operation() -> list[dict]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, provider_key, name, base_url, api_key, is_active, is_enabled,
                           is_builtin, active_model, default_parameters, models_fetched_at,
                           created_at, updated_at
                    FROM llm_providers
                    ORDER BY is_active DESC, is_builtin DESC, name
                    """
                )
                provider_rows = cur.fetchall()

            provider_ids = [row["id"] for row in provider_rows]
            models_by_provider = _fetch_llm_models_for_provider(conn, provider_ids) if include_models else {}

        providers = []
        for row in provider_rows:
            provider = _normalize_llm_provider_row(row)
            if include_models:
                provider["models"] = models_by_provider.get(provider["id"], [])
            providers.append(provider)
        return providers

    return _run_with_retry(operation, "list_llm_providers")


def get_llm_provider(provider_id: str, include_models: bool = True) -> dict | None:
    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, provider_key, name, base_url, api_key, is_active, is_enabled,
                           is_builtin, active_model, default_parameters, models_fetched_at,
                           created_at, updated_at
                    FROM llm_providers
                    WHERE id = %s
                    """,
                    (provider_id,),
                )
                row = cur.fetchone()
            if not row:
                return None
            provider = _normalize_llm_provider_row(row)
            if include_models:
                provider["models"] = _fetch_llm_models_for_provider(conn, [row["id"]]).get(provider["id"], [])
            return provider

    return _run_with_retry(operation, f"get_llm_provider:{provider_id}")


def get_active_llm_config() -> dict | None:
    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.id, p.provider_key, p.name, p.base_url, p.api_key, p.is_active,
                           p.is_enabled, p.is_builtin, p.active_model, p.default_parameters,
                           p.models_fetched_at, p.created_at, p.updated_at,
                           COALESCE(
                             NULLIF(p.active_model, ''),
                             (
                               SELECT m.model_name
                               FROM llm_models m
                               WHERE m.provider_id = p.id AND m.is_enabled
                               ORDER BY m.created_at
                               LIMIT 1
                             )
                           ) AS model_name
                    FROM llm_providers p
                    WHERE p.is_active AND p.is_enabled
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
        return _normalize_llm_provider_row(row)

    return _run_with_retry(operation, "get_active_llm_config")


def create_llm_provider(
    name: str,
    base_url: str,
    api_key: str | None,
    model_names: list[str] | None = None,
    active_model: str | None = None,
) -> dict:
    def operation() -> dict:
        normalized_models = _normalize_model_names(model_names)
        selected_model = (active_model or "").strip()
        if selected_model and selected_model not in normalized_models:
            normalized_models.insert(0, selected_model)
        if not selected_model and normalized_models:
            selected_model = normalized_models[0]

        with _get_connection() as conn:
            with conn.cursor() as cur:
                provider_key = _unique_llm_provider_key(cur, name)
                cur.execute(
                    """
                    INSERT INTO llm_providers (
                      provider_key, name, base_url, api_key, is_builtin, active_model
                    )
                    VALUES (%s, %s, %s, %s, FALSE, %s)
                    RETURNING id, provider_key, name, base_url, api_key, is_active, is_enabled,
                              is_builtin, active_model, default_parameters, models_fetched_at,
                              created_at, updated_at
                    """,
                    (
                        provider_key,
                        name.strip(),
                        base_url.strip().rstrip("/"),
                        (api_key or "").strip() or None,
                        selected_model or None,
                    ),
                )
                provider_row = cur.fetchone()

                for model_name in normalized_models:
                    cur.execute(
                        """
                        INSERT INTO llm_models (provider_id, model_name, display_name, source)
                        VALUES (%s, %s, %s, 'manual')
                        ON CONFLICT (provider_id, model_name) DO NOTHING
                        """,
                        (provider_row["id"], model_name, model_name),
                    )
            conn.commit()

            provider = _normalize_llm_provider_row(provider_row)
            provider["models"] = _fetch_llm_models_for_provider(conn, [provider_row["id"]]).get(provider["id"], [])
            return provider

    return _run_with_retry(operation, f"create_llm_provider:{name}")


def update_llm_provider(
    provider_id: str,
    name: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    api_key_provided: bool = False,
    is_enabled: bool | None = None,
) -> dict | None:
    def operation() -> dict | None:
        updates: list[str] = []
        params: list[object] = []

        if name is not None:
            updates.append("name = %s")
            params.append(name.strip())
        if base_url is not None:
            updates.append("base_url = %s")
            params.append(base_url.strip().rstrip("/"))
        if api_key_provided:
            updates.append("api_key = %s")
            params.append((api_key or "").strip() or None)
        if is_enabled is not None:
            updates.append("is_enabled = %s")
            params.append(is_enabled)

        if not updates:
            return get_llm_provider(provider_id)

        params.append(provider_id)
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE llm_providers
                    SET {", ".join(updates)}, updated_at = NOW()
                    WHERE id = %s
                    RETURNING id, provider_key, name, base_url, api_key, is_active, is_enabled,
                              is_builtin, active_model, default_parameters, models_fetched_at,
                              created_at, updated_at
                    """,
                    params,
                )
                row = cur.fetchone()
            conn.commit()
        if not row:
            return None
        return get_llm_provider(str(row["id"]))

    return _run_with_retry(operation, f"update_llm_provider:{provider_id}")


def add_llm_model(
    provider_id: str,
    model_name: str,
    display_name: str | None = None,
    source: str = "manual",
) -> dict | None:
    def operation() -> dict | None:
        normalized_name = model_name.strip()
        if not normalized_name:
            return None
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM llm_providers WHERE id = %s", (provider_id,))
                if not cur.fetchone():
                    return None
                cur.execute(
                    """
                    INSERT INTO llm_models (provider_id, model_name, display_name, source)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (provider_id, model_name) DO UPDATE SET
                      display_name = COALESCE(EXCLUDED.display_name, llm_models.display_name),
                      is_enabled = TRUE,
                      updated_at = NOW()
                    RETURNING id, provider_id, model_name, display_name, is_enabled,
                              source, created_at, updated_at
                    """,
                    (provider_id, normalized_name, display_name or normalized_name, source),
                )
                model = cur.fetchone()
                cur.execute(
                    """
                    UPDATE llm_providers
                    SET active_model = COALESCE(NULLIF(active_model, ''), %s),
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (normalized_name, provider_id),
                )
            conn.commit()
        return _normalize_llm_model_row(model)

    return _run_with_retry(operation, f"add_llm_model:{provider_id}:{model_name}")


def upsert_fetched_llm_models(provider_id: str, model_names: list[str]) -> tuple[list[dict], int]:
    def operation() -> tuple[list[dict], int]:
        normalized_models = _normalize_model_names(model_names)
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM llm_providers WHERE id = %s", (provider_id,))
                if not cur.fetchone():
                    return [], 0

                cur.execute(
                    "SELECT model_name FROM llm_models WHERE provider_id = %s",
                    (provider_id,),
                )
                existing = {row["model_name"] for row in cur.fetchall()}
                added_count = len([name for name in normalized_models if name not in existing])

                for model_name in normalized_models:
                    cur.execute(
                        """
                        INSERT INTO llm_models (provider_id, model_name, display_name, source)
                        VALUES (%s, %s, %s, 'fetched')
                        ON CONFLICT (provider_id, model_name) DO UPDATE SET
                          display_name = COALESCE(llm_models.display_name, EXCLUDED.display_name),
                          is_enabled = TRUE,
                          updated_at = NOW()
                        """,
                        (provider_id, model_name, model_name),
                    )

                if normalized_models:
                    cur.execute(
                        """
                        UPDATE llm_providers
                        SET active_model = COALESCE(NULLIF(active_model, ''), %s),
                            models_fetched_at = NOW(),
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (normalized_models[0], provider_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE llm_providers
                        SET models_fetched_at = NOW(), updated_at = NOW()
                        WHERE id = %s
                        """,
                        (provider_id,),
                    )

                cur.execute(
                    """
                    SELECT id, provider_id, model_name, display_name, is_enabled, source,
                           created_at, updated_at
                    FROM llm_models
                    WHERE provider_id = %s
                    ORDER BY model_name
                    """,
                    (provider_id,),
                )
                rows = cur.fetchall()
            conn.commit()

        return [_normalize_llm_model_row(row) for row in rows], added_count

    return _run_with_retry(operation, f"upsert_fetched_llm_models:{provider_id}")


def set_active_llm_provider(provider_id: str, model_name: str | None = None) -> dict | None:
    def operation() -> dict | None:
        selected_model = (model_name or "").strip()
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, is_enabled FROM llm_providers WHERE id = %s",
                    (provider_id,),
                )
                provider = cur.fetchone()
                if not provider or not provider["is_enabled"]:
                    return None

                if not selected_model:
                    cur.execute(
                        """
                        SELECT model_name
                        FROM llm_models
                        WHERE provider_id = %s AND is_enabled
                        ORDER BY created_at
                        LIMIT 1
                        """,
                        (provider_id,),
                    )
                    model = cur.fetchone()
                    selected_model = model["model_name"] if model else ""

                if selected_model:
                    cur.execute(
                        """
                        INSERT INTO llm_models (provider_id, model_name, display_name, source)
                        VALUES (%s, %s, %s, 'manual')
                        ON CONFLICT (provider_id, model_name) DO UPDATE SET
                          is_enabled = TRUE,
                          updated_at = NOW()
                        """,
                        (provider_id, selected_model, selected_model),
                    )

                cur.execute("UPDATE llm_providers SET is_active = FALSE WHERE is_active")
                cur.execute(
                    """
                    UPDATE llm_providers
                    SET is_active = TRUE,
                        active_model = NULLIF(%s, ''),
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING id, provider_key, name, base_url, api_key, is_active, is_enabled,
                              is_builtin, active_model, default_parameters, models_fetched_at,
                              created_at, updated_at
                    """,
                    (selected_model, provider_id),
                )
                row = cur.fetchone()
            conn.commit()

        if not row:
            return None
        return get_llm_provider(str(row["id"]))

    return _run_with_retry(operation, f"set_active_llm_provider:{provider_id}")


def get_paper_marks(user_id: str, paper_ids: list[str]) -> dict[str, dict]:
    if not paper_ids:
        return {}

    def operation() -> dict[str, dict]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT paper_id, viewed, liked, favorited, viewed_at, liked_at, favorited_at, updated_at
                    FROM paper_marks
                    WHERE user_id = %s AND paper_id = ANY(%s)
                    """,
                    (user_id, paper_ids),
                )
                rows = cur.fetchall()
        return {
            row["paper_id"]: {
                "viewed": bool(row["viewed"]),
                "liked": bool(row["liked"]),
                "favorited": bool(row["favorited"]),
                "viewed_at": row["viewed_at"],
                "liked_at": row["liked_at"],
                "favorited_at": row["favorited_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        }

    return _run_with_retry(operation, f"get_paper_marks:{user_id}")


def list_marked_papers(
    user_id: str,
    mark_filter: str,
    sort: str,
    offset: int,
    limit: int,
) -> tuple[list[dict], int]:
    filter_clauses = {
        "all": "(pm.viewed = TRUE OR pm.liked = TRUE OR pm.favorited = TRUE)",
        "viewed": "pm.viewed = TRUE",
        "liked": "pm.liked = TRUE",
        "favorited": "pm.favorited = TRUE",
    }
    sort_clauses = {
        "viewed_at": "pm.viewed_at DESC NULLS LAST, pm.updated_at DESC",
        "liked_at": "pm.liked_at DESC NULLS LAST, pm.updated_at DESC",
        "favorited_at": "pm.favorited_at DESC NULLS LAST, pm.updated_at DESC",
        "favorited_first": "pm.favorited DESC, pm.favorited_at DESC NULLS LAST, pm.liked_at DESC NULLS LAST, pm.viewed_at DESC NULLS LAST, pm.updated_at DESC",
        "liked_first": "pm.favorited DESC, pm.favorited_at DESC NULLS LAST, pm.liked_at DESC NULLS LAST, pm.viewed_at DESC NULLS LAST, pm.updated_at DESC",
        "updated_at": "pm.updated_at DESC",
        "title": "LOWER(p.title) ASC NULLS LAST",
    }
    where_clause = filter_clauses.get(mark_filter, filter_clauses["all"])
    order_clause = sort_clauses.get(sort, sort_clauses["viewed_at"])

    def operation() -> tuple[list[dict], int]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        p.id,
                        p.title,
                        p.abstract,
                        p.keywords,
                        p.pdf,
                        p.venue,
                        p.primary_area,
                        p.llm_response,
                        p.created_at,
                        pm.viewed,
                        pm.liked,
                        pm.favorited,
                        pm.viewed_at,
                        pm.liked_at,
                        pm.favorited_at,
                        pm.updated_at AS mark_updated_at
                    FROM paper_marks pm
                    JOIN papers p ON p.id = pm.paper_id
                    WHERE pm.user_id = %s AND {where_clause}
                    ORDER BY {order_clause}, p.id ASC
                    LIMIT %s OFFSET %s
                    """,
                    (user_id, limit, offset),
                )
                rows = cur.fetchall()

                cur.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM paper_marks pm
                    WHERE pm.user_id = %s AND {where_clause}
                    """,
                    (user_id,),
                )
                total = int((cur.fetchone() or {}).get("total") or 0)

        papers = [
            {
                "id": row["id"],
                "title": row.get("title"),
                "abstract": row.get("abstract"),
                "keywords": row.get("keywords") or [],
                "pdf": normalize_paper_pdf_url(row["id"], row.get("pdf")) or get_openreview_pdf_url(row["id"]),
                "venue": row.get("venue"),
                "primary_area": row.get("primary_area"),
                "llm_response": row.get("llm_response"),
                "created_at": row.get("created_at"),
            }
            for row in rows
        ]
        papers, _ = _load_keywords_for_papers(papers)

        items = [
            {
                "paper": paper,
                "mark": {
                    "viewed": bool(row["viewed"]),
                    "liked": bool(row["liked"]),
                    "favorited": bool(row["favorited"]),
                    "viewed_at": row["viewed_at"],
                    "liked_at": row["liked_at"],
                    "favorited_at": row["favorited_at"],
                    "updated_at": row["mark_updated_at"],
                },
            }
            for paper, row in zip(papers, rows)
        ]
        return items, total

    return _run_with_retry(operation, f"list_marked_papers:{user_id}:{mark_filter}:{sort}")


def get_feishu_settings(user_id: str) -> dict | None:
    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT user_id, webhook_url, daily_push_count, enabled,
                           last_tested_at, last_test_status, last_test_error,
                           created_at, updated_at
                    FROM user_feishu_settings
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                return _normalize_feishu_settings_row(cur.fetchone())

    return _run_with_retry(operation, f"get_feishu_settings:{user_id}")


def upsert_feishu_settings(
    user_id: str,
    webhook_url: str,
    daily_push_count: int,
    enabled: bool,
) -> dict:
    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_feishu_settings (
                        user_id, webhook_url, daily_push_count, enabled, updated_at
                    )
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET
                        webhook_url = EXCLUDED.webhook_url,
                        daily_push_count = EXCLUDED.daily_push_count,
                        enabled = EXCLUDED.enabled,
                        updated_at = NOW()
                    RETURNING user_id, webhook_url, daily_push_count, enabled,
                              last_tested_at, last_test_status, last_test_error,
                              created_at, updated_at
                    """,
                    (user_id, webhook_url, daily_push_count, enabled),
                )
                row = cur.fetchone()
            conn.commit()
        return _normalize_feishu_settings_row(row)

    return _run_with_retry(operation, f"upsert_feishu_settings:{user_id}")


def update_feishu_test_result(user_id: str, status: str, error: str | None = None) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE user_feishu_settings
                    SET last_tested_at = NOW(),
                        last_test_status = %s,
                        last_test_error = %s,
                        updated_at = NOW()
                    WHERE user_id = %s
                    """,
                    (status, error, user_id),
                )
            conn.commit()

    _run_with_retry(operation, f"update_feishu_test_result:{user_id}")


def list_enabled_feishu_settings() -> list[dict]:
    def operation() -> list[dict]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT user_id, webhook_url, daily_push_count, enabled,
                           user_feishu_settings.last_tested_at,
                           user_feishu_settings.last_test_status,
                           user_feishu_settings.last_test_error,
                           user_feishu_settings.created_at,
                           user_feishu_settings.updated_at
                    FROM user_feishu_settings
                    JOIN users ON users.id = user_feishu_settings.user_id
                    WHERE user_feishu_settings.enabled = TRUE
                      AND user_feishu_settings.webhook_url <> ''
                      AND users.is_active = TRUE
                    ORDER BY user_feishu_settings.updated_at DESC
                    """
                )
                rows = cur.fetchall()
        return [_normalize_feishu_settings_row(row) for row in rows]

    return _run_with_retry(operation, "list_enabled_feishu_settings")


def set_paper_mark(
    user_id: str,
    paper_id: str,
    viewed: bool | None = None,
    liked: bool | None = None,
    favorited: bool | None = None,
) -> dict:
    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT viewed, liked, favorited
                    FROM paper_marks
                    WHERE user_id = %s AND paper_id = %s
                    """,
                    (user_id, paper_id),
                )
                existing = cur.fetchone() or {"viewed": False, "liked": False, "favorited": False}
                next_viewed = bool(existing["viewed"]) if viewed is None else viewed
                next_liked = bool(existing["liked"]) if liked is None else liked
                next_favorited = bool(existing["favorited"]) if favorited is None else favorited
                if next_liked or next_favorited:
                    next_viewed = True
                if not next_viewed:
                    next_liked = False
                    next_favorited = False

                cur.execute(
                    """
                    INSERT INTO paper_marks (
                        user_id, paper_id, viewed, liked, favorited, viewed_at, liked_at, favorited_at, updated_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s,
                        CASE WHEN %s THEN NOW() ELSE NULL END,
                        CASE WHEN %s THEN NOW() ELSE NULL END,
                        CASE WHEN %s THEN NOW() ELSE NULL END,
                        NOW()
                    )
                    ON CONFLICT (user_id, paper_id) DO UPDATE SET
                        viewed = EXCLUDED.viewed,
                        liked = EXCLUDED.liked,
                        favorited = EXCLUDED.favorited,
                        viewed_at = CASE
                            WHEN EXCLUDED.viewed THEN COALESCE(paper_marks.viewed_at, NOW())
                            ELSE NULL
                        END,
                        liked_at = CASE
                            WHEN EXCLUDED.liked THEN COALESCE(paper_marks.liked_at, NOW())
                            ELSE NULL
                        END,
                        favorited_at = CASE
                            WHEN EXCLUDED.favorited THEN COALESCE(paper_marks.favorited_at, NOW())
                            ELSE NULL
                        END,
                        updated_at = NOW()
                    RETURNING paper_id, viewed, liked, favorited, viewed_at, liked_at, favorited_at, updated_at
                    """,
                    (
                        user_id,
                        paper_id,
                        next_viewed,
                        next_liked,
                        next_favorited,
                        next_viewed,
                        next_liked,
                        next_favorited,
                    ),
                )
                row = cur.fetchone()
            conn.commit()
        return {
            "paper_id": row["paper_id"],
            "viewed": bool(row["viewed"]),
            "liked": bool(row["liked"]),
            "favorited": bool(row["favorited"]),
            "viewed_at": row["viewed_at"],
            "liked_at": row["liked_at"],
            "favorited_at": row["favorited_at"],
            "updated_at": row["updated_at"],
        }

    return _run_with_retry(operation, f"set_paper_mark:{user_id}:{paper_id}")


def migrate_anonymous_data(user_id: str, anonymous_user_id: str | None, marks: dict[str, dict]) -> dict:
    def operation() -> dict:
        migrated_sessions = 0
        migrated_marks = 0
        with _get_connection() as conn:
            with conn.cursor() as cur:
                if anonymous_user_id:
                    cur.execute(
                        """
                        UPDATE chat_sessions
                        SET account_user_id = %s
                        WHERE user_id = %s AND account_user_id IS NULL
                        """,
                        (user_id, anonymous_user_id),
                    )
                    migrated_sessions = cur.rowcount

                for paper_id, mark in marks.items():
                    viewed = bool(mark.get("viewed"))
                    liked = bool(mark.get("liked"))
                    favorited = bool(mark.get("favorited"))
                    if liked or favorited:
                        viewed = True
                    if not viewed and not liked and not favorited:
                        continue
                    cur.execute("SELECT 1 FROM papers WHERE id = %s", (paper_id,))
                    if not cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO paper_marks (
                            user_id, paper_id, viewed, liked, favorited,
                            viewed_at, liked_at, favorited_at, updated_at
                        )
                        VALUES (
                            %s, %s, %s, %s, %s,
                            CASE WHEN %s THEN NOW() ELSE NULL END,
                            CASE WHEN %s THEN NOW() ELSE NULL END,
                            CASE WHEN %s THEN NOW() ELSE NULL END,
                            NOW()
                        )
                        ON CONFLICT (user_id, paper_id) DO UPDATE SET
                            viewed = paper_marks.viewed OR EXCLUDED.viewed,
                            liked = paper_marks.liked OR EXCLUDED.liked,
                            favorited = paper_marks.favorited OR EXCLUDED.favorited,
                            viewed_at = CASE
                                WHEN paper_marks.viewed OR EXCLUDED.viewed THEN COALESCE(paper_marks.viewed_at, NOW())
                                ELSE NULL
                            END,
                            liked_at = CASE
                                WHEN paper_marks.liked OR EXCLUDED.liked THEN COALESCE(paper_marks.liked_at, NOW())
                                ELSE NULL
                            END,
                            favorited_at = CASE
                                WHEN paper_marks.favorited OR EXCLUDED.favorited THEN COALESCE(paper_marks.favorited_at, NOW())
                                ELSE NULL
                            END,
                            updated_at = NOW()
                        """,
                        (user_id, paper_id, viewed, liked, favorited, viewed, liked, favorited),
                    )
                    migrated_marks += 1
            conn.commit()
        return {"sessions": migrated_sessions, "marks": migrated_marks}

    return _run_with_retry(operation, f"migrate_anonymous_data:{user_id}")


def get_chat_sessions(user_id: str, paper_id: str) -> list:
    if not DATABASE_URL:
        return []

    def operation() -> list:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM chat_sessions
                    WHERE user_id = %s AND paper_id = %s
                    ORDER BY created_at DESC
                    """,
                    (user_id, paper_id),
                )
                return cur.fetchall()

    return _run_with_retry(operation, f"get_chat_sessions:{user_id}:{paper_id}")


def get_chat_sessions_for_account(account_user_id: str, paper_id: str) -> list:
    if not DATABASE_URL:
        return []

    def operation() -> list:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM chat_sessions
                    WHERE account_user_id = %s AND paper_id = %s
                    ORDER BY created_at DESC
                    """,
                    (account_user_id, paper_id),
                )
                return [_normalize_session_row(row) for row in cur.fetchall()]

    return _run_with_retry(operation, f"get_chat_sessions_for_account:{account_user_id}:{paper_id}")


def get_chat_session(session_id: str) -> dict | None:
    if not DATABASE_URL:
        return None

    def operation() -> dict | None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM chat_sessions WHERE id = %s", (session_id,))
                return _normalize_session_row(cur.fetchone())

    return _run_with_retry(operation, f"get_chat_session:{session_id}")


def create_chat_session(
    session_id: str,
    user_id: str,
    paper_id: str,
    title: str,
    account_user_id: str | None = None,
):
    if not DATABASE_URL:
        return

    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_sessions (id, user_id, paper_id, title, account_user_id)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (session_id, user_id, paper_id, title, account_user_id),
                )
            conn.commit()

    _run_with_retry(operation, f"create_chat_session:{session_id}")


def get_chat_messages(session_id: str) -> list:
    if not DATABASE_URL:
        return []

    def operation() -> list:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT role, content, created_at
                    FROM chat_messages
                    WHERE session_id = %s
                    ORDER BY created_at
                    """,
                    (session_id,),
                )
                return cur.fetchall()

    return _run_with_retry(operation, f"get_chat_messages:{session_id}")


def save_chat_message(session_id: str, role: str, content: str):
    if not DATABASE_URL:
        return

    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_messages (session_id, role, content)
                    VALUES (%s, %s, %s)
                    """,
                    (session_id, role, content),
                )
            conn.commit()

    _run_with_retry(operation, f"save_chat_message:{session_id}:{role}")


def delete_chat_session(session_id: str):
    if not DATABASE_URL:
        return

    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM chat_messages WHERE session_id = %s", (session_id,))
                cur.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))
            conn.commit()

    _run_with_retry(operation, f"delete_chat_session:{session_id}")


def delete_last_chat_message_pair(session_id: str):
    """Delete the last user+assistant message pair from a session."""
    if not DATABASE_URL:
        return

    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id
                    FROM chat_messages
                    WHERE session_id = %s
                    ORDER BY created_at DESC
                    LIMIT 2
                    """,
                    (session_id,),
                )
                rows = cur.fetchall()
                if rows:
                    cur.execute(
                        "DELETE FROM chat_messages WHERE id = ANY(%s)",
                        ([row["id"] for row in rows],),
                    )
            conn.commit()

    _run_with_retry(operation, f"delete_last_chat_message_pair:{session_id}")


def _build_cache_key(
    venue_prefix: str | None,
    offset: int,
    limit: int,
    search: str | None,
    search_title: bool,
    search_abstract: bool,
    search_keywords: bool,
) -> str:
    scope = venue_prefix if venue_prefix is not None else "all"
    return (
        f"{scope}:{offset}:{limit}:{search or ''}:"
        f"{search_title}:{search_abstract}:{search_keywords}"
    )


def _get_cached_result(cache_key: str):
    current_time = time.time()
    if cache_key in _conference_cache and (
        current_time - _cache_timestamp.get(cache_key, 0)
    ) < _CACHE_TTL_SECONDS:
        return _conference_cache[cache_key]
    return None


def _set_cached_result(cache_key: str, papers: list, total: int):
    _conference_cache[cache_key] = (papers, total)
    _cache_timestamp[cache_key] = time.time()


def _load_keywords_for_papers(papers: list[dict]) -> tuple[list[dict], bool]:
    if not papers:
        return papers, True

    paper_ids = [paper["id"] for paper in papers]

    try:
        with _get_connection() as conn:
            keywords_by_paper = _fetch_keywords_for_papers(conn, paper_ids)
    except Exception:
        for paper in papers:
            paper["keywords"] = []
        return papers, False

    for paper in papers:
        paper["keywords"] = keywords_by_paper.get(paper["id"], [])

    return papers, True


def _search_papers_via_rpc(
    venue_prefix: str | None,
    offset: int,
    limit: int,
    search: str | None,
    search_title: bool,
    search_abstract: bool,
    search_keywords: bool,
) -> tuple[list[dict], int]:
    def operation() -> tuple[list[dict], int]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM search_papers_optimized(%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        search,
                        venue_prefix,
                        search_title,
                        search_abstract,
                        search_keywords,
                        limit,
                        offset,
                    ),
                )
                papers = cur.fetchall()
                papers, _ = _load_keywords_for_papers(papers)

                cur.execute(
                    """
                    SELECT count_papers_optimized(%s, %s, %s, %s, %s) AS total
                    """,
                    (
                        search,
                        venue_prefix,
                        search_title,
                        search_abstract,
                        search_keywords,
                    ),
                )
                row = cur.fetchone()
                total = int(row["total"] or 0)

        return papers, total

    return _run_with_retry(operation, "search_papers_via_rpc")


def _paper_type_priority(paper: dict) -> int:
    venue_value = (paper.get("venue") or "").lower()
    if "oral" in venue_value:
        return 1
    if "spotlight" in venue_value:
        return 2
    if "poster" in venue_value:
        return 3
    return 4


def _normalized_title(paper: dict) -> str:
    return (paper.get("title") or "").casefold()


def _stable_paper_sort_key(paper: dict) -> tuple[int, str, str]:
    return (
        _paper_type_priority(paper),
        _normalized_title(paper),
        paper.get("id") or "",
    )


def _legacy_search_rank_score(
    paper: dict,
    normalized_search: str,
    search_title: bool,
    search_abstract: bool,
    matched_keyword_paper_ids: set[str],
) -> int:
    score = 0
    title = (paper.get("title") or "").casefold()
    abstract = (paper.get("abstract") or "").casefold()
    paper_id = paper.get("id") or ""

    if search_title and normalized_search in title:
        score += 3
    if search_abstract and normalized_search in abstract:
        score += 2
    if paper_id in matched_keyword_paper_ids:
        score += 1

    return score


def _search_papers_legacy(
    venue_prefix: str | None,
    offset: int,
    limit: int,
    search: str | None,
    search_title: bool,
    search_abstract: bool,
    search_keywords: bool,
) -> tuple[list[dict], int]:
    normalized_search = (search or "").casefold()
    matched_keyword_paper_ids: set[str] = set()

    with _get_connection() as conn:
        with conn.cursor() as cur:
            if search and search_keywords:
                cur.execute(
                    """
                    SELECT DISTINCT paper_id
                    FROM keywords
                    WHERE keyword ILIKE %s
                    """,
                    (f"%{search}%",),
                )
                matched_keyword_paper_ids = {
                    row["paper_id"] for row in cur.fetchall()
                }

            query = "SELECT * FROM papers"
            params: list[object] = []
            if venue_prefix:
                query += " WHERE venue ILIKE %s"
                params.append(f"{venue_prefix}%")
            cur.execute(query, params)
            all_papers = cur.fetchall()

    if search:
        filtered_papers = []
        for paper in all_papers:
            title = (paper.get("title") or "").casefold()
            abstract = (paper.get("abstract") or "").casefold()
            paper_id = paper.get("id") or ""

            if (
                (search_title and normalized_search in title)
                or (search_abstract and normalized_search in abstract)
                or (paper_id in matched_keyword_paper_ids)
            ):
                filtered_papers.append(paper)
        all_papers = filtered_papers

    if search:
        sorted_papers = sorted(
            all_papers,
            key=lambda paper: (
                -_legacy_search_rank_score(
                    paper,
                    normalized_search,
                    search_title,
                    search_abstract,
                    matched_keyword_paper_ids,
                ),
                *_stable_paper_sort_key(paper),
            ),
        )
    else:
        sorted_papers = sorted(all_papers, key=_stable_paper_sort_key)

    paginated_papers = sorted_papers[offset : offset + limit]
    paginated_papers, _ = _load_keywords_for_papers(paginated_papers)
    return paginated_papers, len(sorted_papers)


def _search_papers(
    venue_prefix: str | None,
    offset: int,
    limit: int,
    search: str | None,
    search_title: bool,
    search_abstract: bool,
    search_keywords: bool,
) -> tuple[list[dict], int]:
    if not DATABASE_URL:
        return [], 0

    if search and not (search_title or search_abstract or search_keywords):
        return [], 0

    cache_key = _build_cache_key(
        venue_prefix, offset, limit, search, search_title, search_abstract, search_keywords
    )
    cached_result = _get_cached_result(cache_key)
    if cached_result is not None:
        return cached_result

    try:
        papers, total = _search_papers_via_rpc(
            venue_prefix,
            offset,
            limit,
            search,
            search_title,
            search_abstract,
            search_keywords,
        )
    except Exception as exc:
        logger.warning(
            "Falling back to legacy paper search for venue_prefix=%r search=%r: %s",
            venue_prefix,
            search,
            exc,
        )
        papers, total = _search_papers_legacy(
            venue_prefix,
            offset,
            limit,
            search,
            search_title,
            search_abstract,
            search_keywords,
        )

    _set_cached_result(cache_key, papers, total)
    return papers, total


def get_conference_papers(
    venue: str,
    offset: int,
    limit: int,
    search: str = None,
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True,
):
    return _search_papers(
        venue,
        offset,
        limit,
        search,
        search_title,
        search_abstract,
        search_keywords,
    )


def search_all_papers(
    offset: int,
    limit: int,
    search: str = None,
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True,
):
    return _search_papers(
        None,
        offset,
        limit,
        search,
        search_title,
        search_abstract,
        search_keywords,
    )


def has_hf_daily_papers_for_date(daily_date: date) -> bool:
    def operation() -> bool:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM hf_daily_papers WHERE daily_date = %s LIMIT 1",
                    (daily_date,),
                )
                return cur.fetchone() is not None

    return _run_with_retry(operation, f"has_hf_daily_papers_for_date:{daily_date.isoformat()}")


def _paper_from_hf_daily_row(row: dict) -> dict:
    paper = {
        "id": row["id"],
        "title": row.get("title"),
        "abstract": row.get("abstract"),
        "keywords": row.get("keywords") or [],
        "pdf": normalize_paper_pdf_url(row["id"], row.get("pdf")) or get_openreview_pdf_url(row["id"]),
        "venue": row.get("venue"),
        "primary_area": row.get("primary_area"),
        "llm_response": row.get("llm_response"),
        "created_at": row.get("created_at"),
        "hf_daily": {
            "daily_date": row.get("hf_daily_date"),
            "rank": row.get("hf_daily_rank"),
            "upvotes": row.get("hf_daily_upvotes"),
            "thumbnail": row.get("hf_daily_thumbnail"),
            "discussion_id": row.get("hf_daily_discussion_id"),
            "project_page": row.get("hf_daily_project_page"),
            "github_repo": row.get("hf_daily_github_repo"),
            "github_stars": row.get("hf_daily_github_stars"),
            "num_comments": row.get("hf_daily_num_comments"),
        },
    }
    return paper


def select_daily_push_papers_for_user(user_id: str, daily_date: date, limit: int) -> list[dict]:
    """Return the current v1 daily push candidates.

    user_id is intentionally part of the signature so future recommendation
    logic can personalize this selection without changing scheduler code.
    """
    del user_id
    if limit <= 0:
        return []

    def operation() -> list[dict]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.*,
                           h.daily_date AS hf_daily_date,
                           h.rank AS hf_daily_rank,
                           h.upvotes AS hf_daily_upvotes,
                           h.thumbnail AS hf_daily_thumbnail,
                           h.discussion_id AS hf_daily_discussion_id,
                           h.project_page AS hf_daily_project_page,
                           h.github_repo AS hf_daily_github_repo,
                           h.github_stars AS hf_daily_github_stars,
                           h.num_comments AS hf_daily_num_comments
                    FROM hf_daily_papers h
                    JOIN papers p ON p.id = h.paper_id
                    WHERE h.daily_date = %s
                    ORDER BY h.rank ASC, h.upvotes DESC, p.title ASC, p.id ASC
                    LIMIT %s
                    """,
                    (daily_date, limit),
                )
                rows = cur.fetchall()

        papers = [_paper_from_hf_daily_row(row) for row in rows]
        papers, _ = _load_keywords_for_papers(papers)
        return papers

    return _run_with_retry(
        operation,
        f"select_daily_push_papers_for_user:{daily_date.isoformat()}:{limit}",
    )


def has_successful_feishu_push(user_id: str, daily_date: date, paper_id: str) -> bool:
    def operation() -> bool:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM feishu_push_logs
                    WHERE user_id = %s
                      AND daily_date = %s
                      AND paper_id = %s
                      AND status = 'success'
                    LIMIT 1
                    """,
                    (user_id, daily_date, paper_id),
                )
                return cur.fetchone() is not None

    return _run_with_retry(operation, f"has_successful_feishu_push:{user_id}:{daily_date}:{paper_id}")


def record_feishu_push_result(
    user_id: str,
    daily_date: date,
    paper_id: str,
    status: str,
    error: str | None = None,
) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO feishu_push_logs (
                        user_id, daily_date, paper_id, status, error, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (user_id, daily_date, paper_id) DO UPDATE SET
                        status = EXCLUDED.status,
                        error = EXCLUDED.error,
                        updated_at = NOW()
                    """,
                    (user_id, daily_date, paper_id, status, error),
                )
            conn.commit()

    _run_with_retry(operation, f"record_feishu_push_result:{user_id}:{daily_date}:{paper_id}:{status}")


def get_hf_daily_papers(
    offset: int,
    limit: int,
    search: str = None,
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True,
) -> tuple[list[dict], int]:
    if not DATABASE_URL:
        return [], 0

    if search and not (search_title or search_abstract or search_keywords):
        return [], 0

    def operation() -> tuple[list[dict], int]:
        where_parts: list[str] = []
        params: list[object] = []
        if search:
            search_parts = []
            if search_title:
                search_parts.append("p.title ILIKE %s")
                params.append(f"%{search}%")
            if search_abstract:
                search_parts.append("p.abstract ILIKE %s")
                params.append(f"%{search}%")
            if search_keywords:
                search_parts.append(
                    """
                    EXISTS (
                        SELECT 1
                        FROM keywords
                        WHERE keywords.paper_id = p.id
                          AND keywords.keyword ILIKE %s
                    )
                    """
                )
                params.append(f"%{search}%")
            where_parts.append(f"({' OR '.join(search_parts)})")

        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM (
                        SELECT DISTINCT h.paper_id
                        FROM hf_daily_papers h
                        JOIN papers p ON p.id = h.paper_id
                        {where_clause}
                    ) unique_hf_daily_papers
                    """,
                    params,
                )
                total = int(cur.fetchone()["total"] or 0)

                cur.execute(
                    f"""
                    SELECT *
                    FROM (
                        SELECT DISTINCT ON (h.paper_id)
                               p.*,
                               h.daily_date AS hf_daily_date,
                               h.rank AS hf_daily_rank,
                               h.upvotes AS hf_daily_upvotes,
                               h.thumbnail AS hf_daily_thumbnail,
                               h.discussion_id AS hf_daily_discussion_id,
                               h.project_page AS hf_daily_project_page,
                               h.github_repo AS hf_daily_github_repo,
                               h.github_stars AS hf_daily_github_stars,
                               h.num_comments AS hf_daily_num_comments
                        FROM hf_daily_papers h
                        JOIN papers p ON p.id = h.paper_id
                        {where_clause}
                        ORDER BY
                            h.paper_id ASC,
                            h.daily_date DESC,
                            h.upvotes DESC,
                            h.rank ASC,
                            h.id DESC
                    ) latest_hf_daily_papers
                    ORDER BY
                        hf_daily_date DESC,
                        hf_daily_upvotes DESC,
                        hf_daily_rank ASC,
                        title ASC,
                        id ASC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, limit, offset],
                )
                rows = cur.fetchall()

        papers: list[dict] = []
        for row in rows:
            paper = dict(row)
            paper["hf_daily"] = {
                "daily_date": paper.pop("hf_daily_date", None),
                "rank": paper.pop("hf_daily_rank", None),
                "upvotes": paper.pop("hf_daily_upvotes", None),
                "thumbnail": paper.pop("hf_daily_thumbnail", None),
                "discussion_id": paper.pop("hf_daily_discussion_id", None),
                "project_page": paper.pop("hf_daily_project_page", None),
                "github_repo": paper.pop("hf_daily_github_repo", None),
                "github_stars": paper.pop("hf_daily_github_stars", None),
                "num_comments": paper.pop("hf_daily_num_comments", None),
            }
            papers.append(paper)

        papers, _ = _load_keywords_for_papers(papers)
        return papers, total

    return _run_with_retry(operation, "get_hf_daily_papers")


def get_unanalyzed_papers(limit: int = 10) -> list:
    """获取未分析的论文（llm_response IS NULL）"""
    if not DATABASE_URL:
        return []

    def operation() -> list:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, title, venue
                    FROM papers
                    WHERE llm_response IS NULL
                    LIMIT %s
                    """,
                    (limit,),
                )
                return cur.fetchall()

    return _run_with_retry(operation, f"get_unanalyzed_papers:{limit}")


def record_presence(
    client_id: str,
    user_id: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> None:
    def operation() -> None:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO presence_heartbeats (
                        client_id, user_id, user_agent, ip_address, last_seen_at
                    )
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (client_id) DO UPDATE SET
                        user_id = EXCLUDED.user_id,
                        user_agent = EXCLUDED.user_agent,
                        ip_address = EXCLUDED.ip_address,
                        last_seen_at = NOW()
                    """,
                    (client_id, user_id, user_agent, ip_address),
                )
            conn.commit()

    _run_with_retry(operation, f"record_presence:{client_id}")


def get_presence_counts(timeout_seconds: int) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)

    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      COUNT(*) AS total_count,
                      COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS authenticated_count,
                      COUNT(*) FILTER (WHERE user_id IS NULL) AS guest_count
                    FROM presence_heartbeats
                    WHERE last_seen_at > %s
                    """,
                    (cutoff,),
                )
                row = cur.fetchone()
        return {
            "count": int(row["total_count"] or 0),
            "authenticated_count": int(row["authenticated_count"] or 0),
            "guest_count": int(row["guest_count"] or 0),
        }

    return _run_with_retry(operation, "get_presence_counts")


def record_presence_snapshot(timeout_seconds: int, retention_days: int) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)
    retention_cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    def operation() -> dict:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      date_trunc('minute', NOW()) AS bucket_at,
                      COUNT(*) AS total_count,
                      COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS authenticated_count,
                      COUNT(*) FILTER (WHERE user_id IS NULL) AS guest_count
                    FROM presence_heartbeats
                    WHERE last_seen_at > %s
                    """,
                    (cutoff,),
                )
                row = cur.fetchone()
                cur.execute(
                    """
                    INSERT INTO presence_snapshots (
                        bucket_at, total_count, authenticated_count, guest_count
                    )
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (bucket_at) DO UPDATE SET
                        total_count = EXCLUDED.total_count,
                        authenticated_count = EXCLUDED.authenticated_count,
                        guest_count = EXCLUDED.guest_count
                    """,
                    (
                        row["bucket_at"],
                        int(row["total_count"] or 0),
                        int(row["authenticated_count"] or 0),
                        int(row["guest_count"] or 0),
                    ),
                )
                cur.execute(
                    "DELETE FROM presence_snapshots WHERE bucket_at < %s",
                    (retention_cutoff,),
                )
            conn.commit()
        return {
            "bucket_at": row["bucket_at"],
            "count": int(row["total_count"] or 0),
            "authenticated_count": int(row["authenticated_count"] or 0),
            "guest_count": int(row["guest_count"] or 0),
        }

    return _run_with_retry(operation, "record_presence_snapshot")


def get_presence_trend(range_name: str) -> list[dict]:
    hours = 24 if range_name == "24h" else 24 * 7
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    def operation() -> list[dict]:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT bucket_at, total_count, authenticated_count, guest_count
                    FROM presence_snapshots
                    WHERE bucket_at >= %s
                    ORDER BY bucket_at
                    """,
                    (since,),
                )
                rows = cur.fetchall()
        return [
            {
                "bucket_at": row["bucket_at"],
                "count": int(row["total_count"] or 0),
                "authenticated_count": int(row["authenticated_count"] or 0),
                "guest_count": int(row["guest_count"] or 0),
            }
            for row in rows
        ]

    return _run_with_retry(operation, f"get_presence_trend:{range_name}")
