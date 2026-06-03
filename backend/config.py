from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config.yaml"


@dataclass(frozen=True)
class AuthConfig:
    public_registration_enabled: bool = True
    require_email_verification: bool = False
    session_cookie_name: str = "paper_session"
    session_ttl_days: int = 30
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    password_min_length: int = 8


@dataclass(frozen=True)
class PresenceConfig:
    online_timeout_seconds: int = 30
    snapshot_interval_seconds: int = 60
    retention_days: int = 90


@dataclass(frozen=True)
class BackgroundAnalysisConfig:
    enabled: bool = False
    check_interval_seconds: int = 86400


@dataclass(frozen=True)
class HfDailyConfig:
    enabled: bool = True
    api_url: str = "https://huggingface.co/api/daily_papers"
    fetch_time: str = "22:00"
    timezone: str = "Asia/Shanghai"
    top_n: int = 5


@dataclass(frozen=True)
class FeishuNotificationsConfig:
    enabled: bool = True
    push_time: str = "10:00"
    max_daily_push_count: int = 5


@dataclass(frozen=True)
class CorsConfig:
    allowed_origins: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")


@dataclass(frozen=True)
class DatabaseConfig:
    url: str | None = None


@dataclass(frozen=True)
class LlmConfig:
    openai_api_key: str | None = None
    siliconflow_api_key: str | None = None
    open_router_api_key: str | None = None
    step_api_key: str | None = None
    step_base_url: str = "https://api.stepfun.com/v1"
    arkplan_api_key: str | None = None


@dataclass(frozen=True)
class PathsConfig:
    paper_content_cache_dir: str | None = None


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8000


@dataclass(frozen=True)
class AdminConfig:
    email: str | None = None
    initial_password: str | None = None


@dataclass(frozen=True)
class AppConfig:
    database: DatabaseConfig
    llm: LlmConfig
    paths: PathsConfig
    server: ServerConfig
    admin: AdminConfig
    auth: AuthConfig
    presence: PresenceConfig
    background_analysis: BackgroundAnalysisConfig
    hf_daily: HfDailyConfig
    feishu_notifications: FeishuNotificationsConfig
    cors: CorsConfig


def _read_yaml_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}

    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        loaded = yaml.safe_load(config_file) or {}
    if not isinstance(loaded, dict):
        return {}
    return loaded


def _as_bool(value: object, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: object, default: int) -> int:
    if value is None:
        return default
    try:
        return int(str(value))
    except ValueError:
        return default


def _as_str(value: object, default: str) -> str:
    if value is None:
        return default
    return str(value)


def _as_origins(value: object, default: tuple[str, ...]) -> tuple[str, ...]:
    if isinstance(value, list):
        return tuple(str(origin) for origin in value if str(origin).strip())
    return default


def load_app_config() -> AppConfig:
    raw = _read_yaml_config()
    raw_auth = raw.get("auth") if isinstance(raw.get("auth"), dict) else {}
    raw_presence = raw.get("presence") if isinstance(raw.get("presence"), dict) else {}
    raw_background_analysis = raw.get("background_analysis") if isinstance(raw.get("background_analysis"), dict) else {}
    raw_hf_daily = raw.get("hf_daily") if isinstance(raw.get("hf_daily"), dict) else {}
    raw_feishu_notifications = raw.get("feishu_notifications") if isinstance(raw.get("feishu_notifications"), dict) else {}
    raw_cors = raw.get("cors") if isinstance(raw.get("cors"), dict) else {}
    raw_database = raw.get("database") if isinstance(raw.get("database"), dict) else {}
    raw_llm = raw.get("llm") if isinstance(raw.get("llm"), dict) else {}
    raw_paths = raw.get("paths") if isinstance(raw.get("paths"), dict) else {}
    raw_server = raw.get("server") if isinstance(raw.get("server"), dict) else {}
    raw_admin = raw.get("admin") if isinstance(raw.get("admin"), dict) else {}

    default_auth = AuthConfig()
    auth = AuthConfig(
        public_registration_enabled=_as_bool(
            raw_auth.get("public_registration_enabled"),
            default_auth.public_registration_enabled,
        ),
        require_email_verification=_as_bool(
            raw_auth.get("require_email_verification"),
            default_auth.require_email_verification,
        ),
        session_cookie_name=_as_str(
            raw_auth.get("session_cookie_name"),
            default_auth.session_cookie_name,
        ),
        session_ttl_days=_as_int(
            raw_auth.get("session_ttl_days"),
            default_auth.session_ttl_days,
        ),
        cookie_secure=_as_bool(
            raw_auth.get("cookie_secure"),
            default_auth.cookie_secure,
        ),
        cookie_samesite=_as_str(
            raw_auth.get("cookie_samesite"),
            default_auth.cookie_samesite,
        ),
        password_min_length=_as_int(
            raw_auth.get("password_min_length"),
            default_auth.password_min_length,
        ),
    )

    default_presence = PresenceConfig()
    presence = PresenceConfig(
        online_timeout_seconds=_as_int(
            raw_presence.get("online_timeout_seconds"),
            default_presence.online_timeout_seconds,
        ),
        snapshot_interval_seconds=_as_int(
            raw_presence.get("snapshot_interval_seconds"),
            default_presence.snapshot_interval_seconds,
        ),
        retention_days=_as_int(
            raw_presence.get("retention_days"),
            default_presence.retention_days,
        ),
    )

    default_background_analysis = BackgroundAnalysisConfig()
    background_analysis = BackgroundAnalysisConfig(
        enabled=_as_bool(
            raw_background_analysis.get("enabled"),
            default_background_analysis.enabled,
        ),
        check_interval_seconds=_as_int(
            raw_background_analysis.get("check_interval_seconds"),
            default_background_analysis.check_interval_seconds,
        ),
    )

    default_hf_daily = HfDailyConfig()
    hf_daily = HfDailyConfig(
        enabled=_as_bool(
            raw_hf_daily.get("enabled"),
            default_hf_daily.enabled,
        ),
        api_url=_as_str(
            raw_hf_daily.get("api_url"),
            default_hf_daily.api_url,
        ),
        fetch_time=_as_str(
            raw_hf_daily.get("fetch_time"),
            default_hf_daily.fetch_time,
        ),
        timezone=_as_str(
            raw_hf_daily.get("timezone"),
            default_hf_daily.timezone,
        ),
        top_n=_as_int(
            raw_hf_daily.get("top_n"),
            default_hf_daily.top_n,
        ),
    )

    default_feishu_notifications = FeishuNotificationsConfig()
    feishu_notifications = FeishuNotificationsConfig(
        enabled=_as_bool(
            raw_feishu_notifications.get("enabled"),
            default_feishu_notifications.enabled,
        ),
        push_time=_as_str(
            raw_feishu_notifications.get("push_time"),
            default_feishu_notifications.push_time,
        ),
        max_daily_push_count=_as_int(
            raw_feishu_notifications.get("max_daily_push_count"),
            default_feishu_notifications.max_daily_push_count,
        ),
    )

    default_cors = CorsConfig()
    cors = CorsConfig(
        allowed_origins=_as_origins(raw_cors.get("allowed_origins"), default_cors.allowed_origins),
    )

    return AppConfig(
        database=DatabaseConfig(url=raw_database.get("url")),
        llm=LlmConfig(
            openai_api_key=raw_llm.get("openai_api_key"),
            siliconflow_api_key=raw_llm.get("siliconflow_api_key"),
            open_router_api_key=raw_llm.get("open_router_api_key"),
            step_api_key=raw_llm.get("step_api_key"),
            step_base_url=_as_str(raw_llm.get("step_base_url"), LlmConfig.step_base_url),
            arkplan_api_key=raw_llm.get("arkplan_api_key"),
            deepseek_api_key=raw_llm.get("deepseek_api_key"),
        ),
        paths=PathsConfig(paper_content_cache_dir=raw_paths.get("paper_content_cache_dir")),
        server=ServerConfig(
            host=_as_str(raw_server.get("host"), ServerConfig.host),
            port=_as_int(raw_server.get("port"), ServerConfig.port),
        ),
        admin=AdminConfig(
            email=raw_admin.get("email"),
            initial_password=raw_admin.get("initial_password"),
        ),
        auth=auth,
        presence=presence,
        background_analysis=background_analysis,
        hf_daily=hf_daily,
        feishu_notifications=feishu_notifications,
        cors=cors,
    )


settings = load_app_config()
