"""Helpers for the external paper search API (V1).

Covers API key generation/hashing, the in-process RPM sliding window,
Beijing-calendar daily usage dates, and the runtime copy of the global
default quotas (admins can change them without restarting the server).
"""

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, time as dt_time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from config import settings

API_KEY_PREFIX = "pi_"

# Daily quotas reset at Beijing midnight per the PRD.
_DAILY_USAGE_TZ = ZoneInfo("Asia/Shanghai")

# Global defaults for users without a database override. Patched at startup
# from config.yaml and after admin edits; read on every request.
_default_rpm_limit = settings.api_search.default_rpm_limit
_default_daily_limit = settings.api_search.default_daily_limit


def generate_api_key() -> str:
    """Generate a new raw API key. Only ever shown to the user once."""
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(24)}"


def hash_api_key(raw_key: str) -> str:
    """SHA-256 hex digest of the raw key; this is the only value stored."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def build_key_hint(raw_key: str) -> str:
    """Masked hint such as ``pi_ab12...9f8e`` for safe display."""
    tail = raw_key[-4:] if len(raw_key) >= 4 else raw_key
    return f"{raw_key[:8]}...{tail}"


def daily_usage_today() -> datetime:
    """Current Beijing time; the ``.date()`` of this value is the usage key."""
    try:
        return datetime.now(_DAILY_USAGE_TZ)
    except ZoneInfoNotFoundError:  # pragma: no cover - tzdata always present on macOS/Linux
        return datetime.now(ZoneInfo("UTC"))


def seconds_until_daily_reset(now: datetime | None = None) -> int:
    """Seconds until the next Beijing midnight, for Retry-After headers."""
    current = now or daily_usage_today()
    next_midnight = (current.replace(hour=0, minute=0, second=0, microsecond=0)).date()
    reset_at = datetime.combine(next_midnight, dt_time(0, 0, 0), tzinfo=current.tzinfo) + timedelta(days=1)
    return max(int((reset_at - current).total_seconds()), 1)


def get_default_limits() -> tuple[int, int]:
    return _default_rpm_limit, _default_daily_limit


def apply_default_limits(rpm_limit: int, daily_limit: int) -> None:
    global _default_rpm_limit, _default_daily_limit
    _default_rpm_limit = rpm_limit
    _default_daily_limit = daily_limit


def effective_limits(quota: dict | None) -> tuple[int, int]:
    """Resolve (rpm_limit, daily_limit) for a user from their override row."""
    rpm_override = (quota or {}).get("rpm_limit")
    daily_override = (quota or {}).get("daily_limit")
    return (
        int(rpm_override) if rpm_override is not None else _default_rpm_limit,
        int(daily_override) if daily_override is not None else _default_daily_limit,
    )


class SlidingWindowRateLimiter:
    """In-process per-user sliding window for RPM limits.

    Consistent with the project's single-instance deployment assumption
    (chat sessions and similar state are also in-process). All methods are
    synchronous and must be called from the event loop thread without
    awaiting in between the check and the record, so no locking is needed.
    """

    def __init__(self, window_seconds: int = 60) -> None:
        self._window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check_and_record(self, user_id: str, limit: int, now: float | None = None) -> bool:
        """Return True and record the hit when under ``limit`` in the window."""
        current = time.monotonic() if now is None else now
        cutoff = current - self._window_seconds
        hits = self._hits[user_id]
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(current)
        return True

    def retry_after(self, user_id: str, now: float | None = None) -> int:
        """Seconds until the oldest hit in the window expires."""
        current = time.monotonic() if now is None else now
        hits = self._hits.get(user_id)
        if not hits:
            return 1
        return max(int(hits[0] + self._window_seconds - current) + 1, 1)

    def reset(self, user_id: str | None = None) -> None:
        if user_id is None:
            self._hits.clear()
        else:
            self._hits.pop(user_id, None)


# Shared limiter instance for the search API. Window size fixed at 60s: the
# PRD quota is "N requests per minute".
api_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)
