import asyncio
import math
import logging
import secrets
from pathlib import Path
from datetime import datetime, time as datetime_time, timedelta, timezone
from contextlib import asynccontextmanager
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from sse_starlette.sse import EventSourceResponse

from pydantic import BaseModel

from auth import (
    generate_session_token,
    hash_password,
    hash_session_token,
    normalize_email,
    password_needs_rehash,
    verify_password,
)
from config import settings
from llm import ManagedLLM, fetch_openai_compatible_model_names
from migrations import apply_migrations
from github_oauth import (
    GITHUB_AUTHORIZE_URL,
    GithubOAuthError,
    exchange_github_code,
    fetch_github_oauth_user,
)
from utils import get_or_cache_paper_content, get_openreview_info, ReaderError, OpenReviewError, truncate_content_for_llm
from hf_daily import sync_hf_daily_papers
from feishu import (
    FeishuWebhookError,
    build_feishu_paper_card,
    build_feishu_test_card,
    mask_feishu_webhook_url,
    send_feishu_payload,
    validate_feishu_webhook_url,
)
from database import (
    DatabaseError,
    count_active_admins,
    create_chat_session,
    create_or_link_github_user,
    create_user_session,
    delete_chat_session,
    delete_user,
    delete_last_chat_message_pair,
    ensure_admin_user,
    ensure_default_llm_providers,
    add_llm_model,
    get_chat_messages,
    get_chat_session,
    get_chat_sessions_for_account,
    get_conference_papers,
    get_hf_daily_papers,
    get_feishu_settings,
    get_paper,
    get_llm_provider,
    get_paper_marks,
    get_presence_counts,
    get_presence_trend,
    get_user_by_email,
    get_user_by_id,
    get_user_by_session_token_hash,
    has_hf_daily_papers_for_date,
    has_successful_feishu_push,
    list_enabled_feishu_settings,
    list_marked_papers,
    list_llm_providers,
    list_users,
    migrate_anonymous_data,
    record_presence,
    record_feishu_push_result,
    record_presence_snapshot,
    revoke_session,
    revoke_user_sessions,
    save_chat_message,
    save_paper,
    search_all_papers,
    select_daily_push_papers_for_user,
    set_paper_mark,
    set_active_llm_provider,
    create_llm_provider,
    update_feishu_test_result,
    update_llm_response,
    update_llm_provider,
    upsert_fetched_llm_models,
    upsert_feishu_settings,
    update_user_admin_fields,
    update_user_last_login,
    update_user_password,
)
from chat import ChatSession
from background_tasks import BackgroundAnalyzer
from markdown_utils import normalize_llm_markdown

logger = logging.getLogger(__name__)
GITHUB_OAUTH_STATE_COOKIE = "paper_github_oauth_state"
GITHUB_OAUTH_NEXT_COOKIE = "paper_github_oauth_next"
GITHUB_OAUTH_COOKIE_MAX_AGE_SECONDS = 600

llm = ManagedLLM()
chat_sessions: dict[str, ChatSession] = {}
background_analyzer = BackgroundAnalyzer(llm, check_interval=settings.background_analysis.check_interval_seconds)
background_task = None
presence_snapshot_task = None
hf_daily_task = None
feishu_push_task = None
hf_daily_analysis_tasks: set[asyncio.Task] = set()


async def run_presence_snapshots():
    while True:
        try:
            await asyncio.to_thread(
                record_presence_snapshot,
                settings.presence.online_timeout_seconds,
                settings.presence.retention_days,
            )
        except DatabaseError as exc:
            logger.warning("在线人数快照写入失败: %s", exc)
        await asyncio.sleep(settings.presence.snapshot_interval_seconds)


def get_hf_daily_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.hf_daily.timezone)
    except ZoneInfoNotFoundError:
        logger.warning("HF Daily timezone 无效，回退到 UTC: %s", settings.hf_daily.timezone)
        return ZoneInfo("UTC")


def get_hf_daily_fetch_time() -> datetime_time:
    raw_value = settings.hf_daily.fetch_time.strip()
    try:
        hour_text, minute_text = raw_value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return datetime_time(hour=hour, minute=minute)
    except (ValueError, AttributeError):
        pass

    logger.warning("HF Daily fetch_time 无效，回退到 22:00: %s", raw_value)
    return datetime_time(hour=22, minute=0)


def get_feishu_push_time() -> datetime_time:
    raw_value = settings.feishu_notifications.push_time.strip()
    try:
        hour_text, minute_text = raw_value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return datetime_time(hour=hour, minute=minute)
    except (ValueError, AttributeError):
        pass

    logger.warning("Feishu push_time 无效，回退到 10:00: %s", raw_value)
    return datetime_time(hour=10, minute=0)


async def analyze_hf_daily_papers(paper_ids: list[str]) -> None:
    if not paper_ids:
        return
    if not llm.is_configured():
        logger.warning("HF Daily 已入库，但 LLM 未配置，跳过自动分析")
        return

    seen: set[str] = set()
    for paper_id in paper_ids:
        if paper_id in seen:
            continue
        seen.add(paper_id)
        await background_analyzer.analyze_paper(paper_id)
        await asyncio.sleep(1)


def schedule_hf_daily_analysis(paper_ids: list[str]) -> None:
    if not paper_ids:
        return
    task = asyncio.create_task(analyze_hf_daily_papers(paper_ids))
    hf_daily_analysis_tasks.add(task)

    def finalize(completed_task: asyncio.Task) -> None:
        hf_daily_analysis_tasks.discard(completed_task)
        try:
            completed_task.result()
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("HF Daily 自动分析任务失败: %s", exc)

    task.add_done_callback(finalize)


async def sync_hf_daily_once() -> dict:
    tz = get_hf_daily_timezone()
    daily_date = datetime.now(tz).date()
    top_n = max(settings.hf_daily.top_n, settings.feishu_notifications.max_daily_push_count)
    result = await asyncio.to_thread(
        sync_hf_daily_papers,
        settings.hf_daily.api_url,
        top_n,
        daily_date,
    )
    schedule_hf_daily_analysis(result.get("analyzable_paper_ids", []))
    return result


async def ensure_paper_has_analysis(paper: dict) -> dict | None:
    if paper.get("llm_response"):
        return paper
    if not llm.is_configured():
        logger.warning("飞书推送跳过未分析论文，LLM 未配置: %s", paper.get("id"))
        return None

    paper_id = paper["id"]
    ok = await background_analyzer.analyze_paper(paper_id)
    if not ok:
        return None
    refreshed = await asyncio.to_thread(get_paper, paper_id)
    if not refreshed or not refreshed.get("llm_response"):
        return None
    paper["llm_response"] = refreshed["llm_response"]
    return paper


async def push_feishu_notifications_for_date(daily_date) -> None:
    users = await asyncio.to_thread(list_enabled_feishu_settings)
    if not users:
        logger.info("Feishu 每日推送跳过：没有启用用户")
        return

    max_count = max(1, min(settings.feishu_notifications.max_daily_push_count, 5))
    for setting in users:
        user_id = setting["user_id"]
        push_count = max(1, min(int(setting.get("daily_push_count") or 1), max_count))
        papers = await asyncio.to_thread(
            select_daily_push_papers_for_user,
            user_id,
            daily_date,
            push_count,
        )
        for paper in papers:
            paper_id = paper["id"]
            already_sent = await asyncio.to_thread(
                has_successful_feishu_push,
                user_id,
                daily_date,
                paper_id,
            )
            if already_sent:
                continue

            analyzed_paper = await ensure_paper_has_analysis(paper)
            if not analyzed_paper:
                await asyncio.to_thread(
                    record_feishu_push_result,
                    user_id,
                    daily_date,
                    paper_id,
                    "failed",
                    "AI analysis is not available",
                )
                continue

            try:
                payload = build_feishu_paper_card(analyzed_paper, daily_date)
                await asyncio.to_thread(send_feishu_payload, setting["webhook_url"], payload)
                await asyncio.to_thread(
                    record_feishu_push_result,
                    user_id,
                    daily_date,
                    paper_id,
                    "success",
                    None,
                )
            except Exception as exc:
                logger.warning(
                    "Feishu 每日推送失败: user=%s paper=%s error=%s",
                    user_id,
                    paper_id,
                    exc,
                )
                await asyncio.to_thread(
                    record_feishu_push_result,
                    user_id,
                    daily_date,
                    paper_id,
                    "failed",
                    str(exc)[:500],
                )


async def run_feishu_push_scheduler():
    logger.info(
        "Feishu 每日推送任务启动: enabled=%s time=%s timezone=%s",
        settings.feishu_notifications.enabled,
        settings.feishu_notifications.push_time,
        settings.hf_daily.timezone,
    )
    while True:
        tz = get_hf_daily_timezone()
        push_time = get_feishu_push_time()
        now = datetime.now(tz)
        today_run_at = datetime.combine(now.date(), push_time, tzinfo=tz)

        try:
            if now >= today_run_at:
                target_date = now.date() - timedelta(days=1)
                await push_feishu_notifications_for_date(target_date)
                now = datetime.now(tz)

            next_run_date = now.date()
            if now >= datetime.combine(next_run_date, push_time, tzinfo=tz):
                next_run_date = next_run_date + timedelta(days=1)
            next_run_at = datetime.combine(next_run_date, push_time, tzinfo=tz)
            await asyncio.sleep(max((next_run_at - now).total_seconds(), 60))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Feishu 每日推送任务失败，1 小时后重试: %s", exc)
            await asyncio.sleep(3600)


async def run_hf_daily_scheduler():
    logger.info(
        "HF Daily 定时任务启动: enabled=%s time=%s timezone=%s top_n=%s",
        settings.hf_daily.enabled,
        settings.hf_daily.fetch_time,
        settings.hf_daily.timezone,
        settings.hf_daily.top_n,
    )
    while True:
        tz = get_hf_daily_timezone()
        fetch_time = get_hf_daily_fetch_time()
        now = datetime.now(tz)
        today_run_at = datetime.combine(now.date(), fetch_time, tzinfo=tz)

        try:
            if now >= today_run_at:
                already_synced = await asyncio.to_thread(has_hf_daily_papers_for_date, now.date())
                if not already_synced:
                    logger.info("开始补抓今日 HF Daily Papers: %s", now.date().isoformat())
                    await sync_hf_daily_once()
                    now = datetime.now(tz)

            next_run_date = now.date()
            if now >= datetime.combine(next_run_date, fetch_time, tzinfo=tz):
                next_run_date = next_run_date + timedelta(days=1)
            next_run_at = datetime.combine(next_run_date, fetch_time, tzinfo=tz)
            await asyncio.sleep(max((next_run_at - now).total_seconds(), 60))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("HF Daily 定时任务失败，1 小时后重试: %s", exc)
            await asyncio.sleep(3600)


def bootstrap_admin_user() -> None:
    if not settings.admin.email or not settings.admin.initial_password:
        logger.info("未配置 admin.email/admin.initial_password，跳过初始管理员创建")
        return

    normalized = normalize_email(settings.admin.email)
    ensure_admin_user(
        settings.admin.email.strip(),
        normalized,
        hash_password(settings.admin.initial_password),
    )
    logger.info("初始管理员已确认: %s", normalized)


def bootstrap_llm_providers() -> None:
    ensure_default_llm_providers(
        [
            {
                "provider_key": "step",
                "name": "Step",
                "base_url": settings.llm.step_base_url,
                "api_key": settings.llm.step_api_key,
                "active_model": "step-3.5-flash-2603",
                "models": ["step-3.5-flash-2603"],
            },
            {
                "provider_key": "openrouter",
                "name": "OpenRouter",
                "base_url": "https://openrouter.ai/api/v1",
                "api_key": settings.llm.open_router_api_key,
                "active_model": "stepfun/step-3.5-flash:free",
                "models": ["stepfun/step-3.5-flash:free"],
                "default_parameters": {"max_completion_tokens": 12000},
            },
            {
                "provider_key": "siliconflow",
                "name": "SiliconFlow",
                "base_url": "https://api.siliconflow.cn/v1",
                "api_key": settings.llm.siliconflow_api_key,
                "active_model": "Pro/MiniMaxAI/MiniMax-M2.5",
                "models": ["Pro/MiniMaxAI/MiniMax-M2.5"],
            },
            {
                "provider_key": "arkplan",
                "name": "ArkPlan",
                "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3",
                "api_key": settings.llm.arkplan_api_key,
                "active_model": "ark-code-latest",
                "models": ["ark-code-latest"],
            },
            {
                "provider_key": "openai",
                "name": "OpenAI",
                "base_url": "https://api.openai.com/v1",
                "api_key": settings.llm.openai_api_key,
                "active_model": "gpt-4.1-mini",
                "models": ["gpt-4.1-mini"],
            },
            {
                "provider_key": "deepseek",
                "name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": settings.llm.deepseek_api_key,
                "active_model": "deepseek-chat",
                "models": ["deepseek-chat", "deepseek-reasoner"],
            },
        ]
    )
    logger.info("LLM 供应商配置已确认")


def ensure_llm_configured() -> None:
    if not llm.is_configured():
        raise HTTPException(status_code=503, detail="当前 LLM 供应商、模型或 API Key 未配置")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global background_task, presence_snapshot_task, hf_daily_task, feishu_push_task
    try:
        await asyncio.to_thread(apply_migrations)
    except Exception as exc:
        logger.error("数据库 migration 失败: %s", exc)
        raise

    try:
        await asyncio.to_thread(bootstrap_admin_user)
    except DatabaseError as exc:
        logger.warning("初始管理员创建失败: %s", exc)

    try:
        await asyncio.to_thread(bootstrap_llm_providers)
    except DatabaseError as exc:
        logger.warning("LLM 供应商初始化失败: %s", exc)

    if settings.background_analysis.enabled:
        background_task = asyncio.create_task(background_analyzer.run())
        logger.info("后台分析任务已启动")
    else:
        logger.info("后台分析任务未启用")

    presence_snapshot_task = asyncio.create_task(run_presence_snapshots())
    if settings.hf_daily.enabled:
        hf_daily_task = asyncio.create_task(run_hf_daily_scheduler())
    else:
        logger.info("HF Daily 定时任务未启用")
    if settings.feishu_notifications.enabled:
        feishu_push_task = asyncio.create_task(run_feishu_push_scheduler())
    else:
        logger.info("Feishu 每日推送任务未启用")

    yield

    background_analyzer.stop()
    for task in (background_task, presence_snapshot_task, hf_daily_task, feishu_push_task, *hf_daily_analysis_tasks):
        if not task:
            continue
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("后台分析任务已停止")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors.allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: str
    user_id: str | None = None


class AuthRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class PaperMarkPayload(BaseModel):
    viewed: bool | None = None
    liked: bool | None = None
    favorited: bool | None = None


class AnonymousMigrationRequest(BaseModel):
    anonymous_user_id: str | None = None
    paper_marks: dict[str, PaperMarkPayload] = {}


class PresenceRequest(BaseModel):
    client_id: str | None = None
    user_id: str | None = None


class AdminUserUpdateRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str


class FeishuWebhookSettingsRequest(BaseModel):
    webhook_url: str | None = None
    daily_push_count: int = 3
    enabled: bool = True


class LlmProviderCreateRequest(BaseModel):
    name: str
    base_url: str
    api_key: str | None = None
    models: list[str] = []
    active_model: str | None = None


class LlmProviderUpdateRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    is_enabled: bool | None = None


class LlmModelCreateRequest(BaseModel):
    model_name: str
    display_name: str | None = None


class LlmActiveRequest(BaseModel):
    provider_id: str
    model_name: str | None = None


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "is_active": user["is_active"],
        "email_verified": user["email_verified"],
        "created_at": user.get("created_at"),
        "last_login_at": user.get("last_login_at"),
    }


def public_feishu_settings(settings_row: dict | None) -> dict:
    if not settings_row:
        return {
            "configured": False,
            "webhook_url_masked": None,
            "enabled": False,
            "daily_push_count": 3,
            "last_tested_at": None,
            "last_test_status": None,
            "last_test_error": None,
        }
    return {
        "configured": True,
        "webhook_url_masked": mask_feishu_webhook_url(settings_row.get("webhook_url")),
        "enabled": bool(settings_row.get("enabled")),
        "daily_push_count": settings_row.get("daily_push_count") or 3,
        "last_tested_at": settings_row.get("last_tested_at"),
        "last_test_status": settings_row.get("last_test_status"),
        "last_test_error": settings_row.get("last_test_error"),
    }


def mask_api_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def public_llm_model(model: dict) -> dict:
    return {
        "id": model["id"],
        "provider_id": model["provider_id"],
        "model_name": model["model_name"],
        "display_name": model.get("display_name"),
        "is_enabled": model.get("is_enabled", True),
        "source": model.get("source"),
        "created_at": model.get("created_at"),
        "updated_at": model.get("updated_at"),
    }


def public_llm_provider(provider: dict) -> dict:
    models = provider.get("models") or []
    return {
        "id": provider["id"],
        "provider_key": provider.get("provider_key"),
        "name": provider["name"],
        "base_url": provider["base_url"],
        "has_api_key": bool(provider.get("api_key")),
        "api_key_masked": mask_api_key(provider.get("api_key")),
        "is_active": bool(provider.get("is_active")),
        "is_enabled": bool(provider.get("is_enabled")),
        "is_builtin": bool(provider.get("is_builtin")),
        "active_model": provider.get("active_model"),
        "default_parameters": provider.get("default_parameters") or {},
        "models_fetched_at": provider.get("models_fetched_at"),
        "created_at": provider.get("created_at"),
        "updated_at": provider.get("updated_at"),
        "models": [public_llm_model(model) for model in models],
    }


def validate_email_and_password(email: str, password: str) -> str:
    normalized = normalize_email(email)
    if "@" not in normalized or "." not in normalized.split("@")[-1]:
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    if len(password) < settings.auth.password_min_length:
        raise HTTPException(
            status_code=400,
            detail=f"密码至少需要 {settings.auth.password_min_length} 个字符",
        )
    return normalized


def get_request_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else None


def set_session_cookie(response: Response, token: str) -> None:
    max_age = settings.auth.session_ttl_days * 24 * 3600
    response.set_cookie(
        key=settings.auth.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.auth.cookie_secure,
        samesite=settings.auth.cookie_samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth.session_cookie_name,
        path="/",
        samesite=settings.auth.cookie_samesite,
        secure=settings.auth.cookie_secure,
        httponly=True,
    )


def current_session_token(request: Request) -> str | None:
    return request.cookies.get(settings.auth.session_cookie_name)


def get_current_user_optional(request: Request) -> dict | None:
    token = current_session_token(request)
    if not token:
        return None
    return get_user_by_session_token_hash(hash_session_token(token))


def require_current_user(request: Request) -> dict:
    try:
        user = get_current_user_optional(request)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def require_admin_user(user: dict = Depends(require_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def create_login_session(user: dict, request: Request, response: Response) -> None:
    token = generate_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.auth.session_ttl_days)
    create_user_session(
        user["id"],
        hash_session_token(token),
        expires_at,
        request.headers.get("user-agent"),
        get_request_ip(request),
    )
    set_session_cookie(response, token)
    update_user_last_login(user["id"])


def sanitize_frontend_path(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    return value


def build_frontend_redirect(path: str = "/", params: dict[str, str] | None = None) -> str:
    safe_path = sanitize_frontend_path(path)
    if params:
        separator = "&" if "?" in safe_path else "?"
        safe_path = f"{safe_path}{separator}{urlencode(params)}"
    frontend_base_url = (settings.auth.frontend_base_url or "").strip().rstrip("/")
    if not frontend_base_url:
        return safe_path
    return f"{frontend_base_url}{safe_path}"


def get_github_callback_url(request: Request) -> str:
    configured_callback_url = (settings.auth.github_callback_url or "").strip()
    if configured_callback_url:
        return configured_callback_url
    return str(request.url_for("github_callback"))


def github_oauth_is_configured() -> bool:
    return bool(settings.auth.github_client_id and settings.auth.github_client_secret)


def set_github_oauth_cookie(response: Response, key: str, value: str) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=GITHUB_OAUTH_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.auth.cookie_secure,
        samesite=settings.auth.cookie_samesite,
        path="/auth/github",
    )


def clear_github_oauth_cookies(response: Response) -> None:
    for key in (GITHUB_OAUTH_STATE_COOKIE, GITHUB_OAUTH_NEXT_COOKIE):
        response.delete_cookie(
            key=key,
            path="/auth/github",
            samesite=settings.auth.cookie_samesite,
            secure=settings.auth.cookie_secure,
            httponly=True,
        )


def redirect_to_auth_error(error_code: str) -> RedirectResponse:
    response = RedirectResponse(
        build_frontend_redirect("/login", {"oauth_error": error_code}),
        status_code=302,
    )
    clear_github_oauth_cookies(response)
    return response


def assert_chat_owner(session_id: str, user_id: str) -> dict | None:
    session_row = get_chat_session(session_id)
    if session_row and session_row.get("account_user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return session_row


@app.post("/auth/register")
async def register():
    raise HTTPException(status_code=410, detail="当前仅支持使用 GitHub 注册")


@app.get("/auth/github/start")
async def github_start(request: Request, next: str = "/"):
    if not github_oauth_is_configured():
        return redirect_to_auth_error("github_not_configured")

    state = secrets.token_urlsafe(32)
    redirect_uri = get_github_callback_url(request)
    params = {
        "client_id": settings.auth.github_client_id,
        "redirect_uri": redirect_uri,
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    response = RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}", status_code=302)
    set_github_oauth_cookie(response, GITHUB_OAUTH_STATE_COOKIE, state)
    set_github_oauth_cookie(response, GITHUB_OAUTH_NEXT_COOKIE, sanitize_frontend_path(next))
    return response


@app.get("/auth/github/callback")
async def github_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    next_path = sanitize_frontend_path(request.cookies.get(GITHUB_OAUTH_NEXT_COOKIE))
    expected_state = request.cookies.get(GITHUB_OAUTH_STATE_COOKIE)
    if error:
        return redirect_to_auth_error("github_cancelled")
    if not code or not state or not expected_state or not secrets.compare_digest(state, expected_state):
        return redirect_to_auth_error("github_state_invalid")
    if not github_oauth_is_configured():
        return redirect_to_auth_error("github_not_configured")

    redirect_response = RedirectResponse(build_frontend_redirect(next_path), status_code=302)
    clear_github_oauth_cookies(redirect_response)
    try:
        access_token = await asyncio.to_thread(
            exchange_github_code,
            settings.auth.github_client_id,
            settings.auth.github_client_secret,
            code,
            get_github_callback_url(request),
        )
        github_user = await asyncio.to_thread(fetch_github_oauth_user, access_token)
        user, link_error = await asyncio.to_thread(
            create_or_link_github_user,
            github_user.email.strip(),
            normalize_email(github_user.email),
            github_user.provider_user_id,
            github_user.login,
            github_user.name,
            github_user.avatar_url,
        )
        if link_error == "email_linked_to_different_github":
            return redirect_to_auth_error("github_email_conflict")
        if not user:
            return redirect_to_auth_error("github_login_failed")
        if not user["is_active"]:
            return redirect_to_auth_error("github_user_disabled")
        create_login_session(user, request, redirect_response)
        return redirect_response
    except GithubOAuthError as exc:
        logger.warning("GitHub OAuth failed: %s", exc)
        return redirect_to_auth_error("github_login_failed")
    except DatabaseError as exc:
        logger.warning("GitHub OAuth database failure: %s", exc)
        return redirect_to_auth_error("github_database_unavailable")


@app.post("/auth/login")
async def login(req: AuthRequest, request: Request, response: Response):
    normalized = validate_email_and_password(req.email, req.password)
    try:
        user = get_user_by_email(normalized)
        password_hash = user.get("password_hash") if user else None
        if not user or not password_hash or not verify_password(password_hash, req.password):
            raise HTTPException(status_code=401, detail="邮箱或密码错误")
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="账号已被停用")
        if password_needs_rehash(password_hash):
            update_user_password(user["id"], hash_password(req.password))
            user = get_user_by_id(user["id"]) or user
        create_login_session(user, request, response)
        return {"user": public_user(user)}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = current_session_token(request)
    if token:
        try:
            revoke_session(hash_session_token(token))
        except DatabaseError as exc:
            raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc
    clear_session_cookie(response)
    return {"ok": True}


@app.get("/auth/me")
async def me(user: dict = Depends(require_current_user)):
    return {"user": public_user(user)}


@app.post("/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    user: dict = Depends(require_current_user),
):
    validate_email_and_password(user["email"], req.new_password)
    password_hash = user.get("password_hash")
    if not password_hash:
        raise HTTPException(status_code=400, detail="当前账号未设置密码，请使用 GitHub 登录")
    if not verify_password(password_hash, req.current_password):
        raise HTTPException(status_code=400, detail="当前密码错误")
    token = current_session_token(request)
    token_hash = hash_session_token(token) if token else None
    try:
        update_user_password(user["id"], hash_password(req.new_password))
        revoke_user_sessions(user["id"], except_token_hash=token_hash)
        return {"ok": True}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/auth/migrate-anonymous")
async def migrate_anonymous(
    req: AnonymousMigrationRequest,
    user: dict = Depends(require_current_user),
):
    marks = {
        paper_id: mark.model_dump(exclude_none=True)
        for paper_id, mark in req.paper_marks.items()
    }
    try:
        return migrate_anonymous_data(user["id"], req.anonymous_user_id, marks)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/online/heartbeat")
async def heartbeat(req: PresenceRequest, request: Request):
    client_id = req.client_id or req.user_id
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    try:
        user = get_current_user_optional(request)
        record_presence(
            client_id,
            user["id"] if user else None,
            request.headers.get("user-agent"),
            get_request_ip(request),
        )
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc
    return {"status": "ok"}


@app.get("/online/count")
async def get_online_count():
    try:
        return get_presence_counts(settings.presence.online_timeout_seconds)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.get("/me/paper-marks")
async def list_my_paper_marks(request: Request, paper_ids: str = ""):
    ids = [paper_id for paper_id in paper_ids.split(",") if paper_id]
    try:
        user = get_current_user_optional(request)
        if not user:
            return {"marks": {}}
        return {"marks": get_paper_marks(user["id"], ids)}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.get("/me/feishu-webhook")
async def get_my_feishu_webhook(user: dict = Depends(require_current_user)):
    try:
        return public_feishu_settings(get_feishu_settings(user["id"]))
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.put("/me/feishu-webhook")
async def update_my_feishu_webhook(
    req: FeishuWebhookSettingsRequest,
    user: dict = Depends(require_current_user),
):
    max_count = max(1, min(settings.feishu_notifications.max_daily_push_count, 5))
    if not 1 <= req.daily_push_count <= max_count:
        raise HTTPException(status_code=400, detail=f"每日推送篇数需要在 1 到 {max_count} 之间")

    try:
        existing = get_feishu_settings(user["id"])
        raw_webhook_url = (req.webhook_url or "").strip()
        if raw_webhook_url:
            webhook_url = validate_feishu_webhook_url(raw_webhook_url)
        elif existing:
            webhook_url = existing["webhook_url"]
        else:
            raise HTTPException(status_code=400, detail="请先填写飞书 webhook URL")

        updated = upsert_feishu_settings(
            user["id"],
            webhook_url,
            req.daily_push_count,
            req.enabled,
        )
        return public_feishu_settings(updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/me/feishu-webhook/test")
async def test_my_feishu_webhook(user: dict = Depends(require_current_user)):
    try:
        settings_row = get_feishu_settings(user["id"])
        if not settings_row:
            raise HTTPException(status_code=400, detail="请先保存飞书 webhook URL")
        result = await asyncio.to_thread(
            send_feishu_payload,
            settings_row["webhook_url"],
            build_feishu_test_card(),
        )
        await asyncio.to_thread(update_feishu_test_result, user["id"], "success", None)
        return {"ok": True, "result": result}
    except HTTPException:
        raise
    except FeishuWebhookError as exc:
        try:
            await asyncio.to_thread(update_feishu_test_result, user["id"], "failed", str(exc)[:500])
        except DatabaseError:
            pass
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.get("/me/papers")
async def list_my_papers(
    page: int = 1,
    limit: int = 12,
    filter: str = "all",
    sort: str = "viewed_at",
    user: dict = Depends(require_current_user),
):
    if filter not in {"all", "viewed", "liked", "favorited"}:
        raise HTTPException(status_code=400, detail="filter must be all, viewed, liked, or favorited")
    if sort not in {"viewed_at", "liked_at", "liked_first", "favorited_at", "favorited_first", "updated_at", "title"}:
        raise HTTPException(status_code=400, detail="unsupported sort")

    safe_page = max(page, 1)
    safe_limit = min(max(limit, 1), 50)
    offset = (safe_page - 1) * safe_limit
    try:
        items, total = list_marked_papers(user["id"], filter, sort, offset, safe_limit)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc

    return {
        "items": items,
        "total": total,
        "page": safe_page,
        "pages": math.ceil(total / safe_limit) if total > 0 else 1,
    }


@app.put("/papers/{paper_id}/mark")
async def update_my_paper_mark(
    paper_id: str,
    req: PaperMarkPayload,
    user: dict = Depends(require_current_user),
):
    try:
        return set_paper_mark(
            user["id"],
            paper_id,
            viewed=req.viewed,
            liked=req.liked,
            favorited=req.favorited,
        )
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.get("/admin/metrics/online")
async def admin_online_metrics(range: str = "24h", admin: dict = Depends(require_admin_user)):
    if range not in {"24h", "7d"}:
        raise HTTPException(status_code=400, detail="range must be 24h or 7d")
    try:
        return {
            "current": get_presence_counts(settings.presence.online_timeout_seconds),
            "trend": get_presence_trend(range),
        }
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/hf-daily-papers/sync")
async def admin_sync_hf_daily_papers(admin: dict = Depends(require_admin_user)):
    try:
        return await sync_hf_daily_once()
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc
    except Exception as exc:
        logger.warning("管理员手动同步 HF Daily Papers 失败: %s", exc)
        raise HTTPException(status_code=502, detail="HF Daily Papers sync failed") from exc


@app.get("/admin/llm/providers")
async def admin_list_llm_providers(admin: dict = Depends(require_admin_user)):
    try:
        providers = list_llm_providers()
        return {"providers": [public_llm_provider(provider) for provider in providers]}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/llm/providers")
async def admin_create_llm_provider(
    req: LlmProviderCreateRequest,
    admin: dict = Depends(require_admin_user),
):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="供应商名称不能为空")
    if not req.base_url.strip().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")
    try:
        provider = create_llm_provider(
            req.name,
            req.base_url,
            req.api_key,
            req.models,
            req.active_model,
        )
        return public_llm_provider(provider)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.patch("/admin/llm/providers/{provider_id}")
async def admin_update_llm_provider(
    provider_id: str,
    req: LlmProviderUpdateRequest,
    admin: dict = Depends(require_admin_user),
):
    if req.name is not None and not req.name.strip():
        raise HTTPException(status_code=400, detail="供应商名称不能为空")
    if req.base_url is not None and not req.base_url.strip().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")

    fields_set = getattr(req, "model_fields_set", set())
    try:
        provider = update_llm_provider(
            provider_id,
            name=req.name,
            base_url=req.base_url,
            api_key=req.api_key,
            api_key_provided="api_key" in fields_set,
            is_enabled=req.is_enabled,
        )
        if not provider:
            raise HTTPException(status_code=404, detail="供应商不存在")
        return public_llm_provider(provider)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/llm/providers/{provider_id}/models")
async def admin_add_llm_model(
    provider_id: str,
    req: LlmModelCreateRequest,
    admin: dict = Depends(require_admin_user),
):
    if not req.model_name.strip():
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    try:
        model = add_llm_model(provider_id, req.model_name, req.display_name)
        if not model:
            raise HTTPException(status_code=404, detail="供应商不存在")
        return public_llm_model(model)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/llm/providers/{provider_id}/fetch-models")
async def admin_fetch_llm_models(
    provider_id: str,
    admin: dict = Depends(require_admin_user),
):
    try:
        provider = get_llm_provider(provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="供应商不存在")
        model_names = await fetch_openai_compatible_model_names(
            provider["base_url"],
            provider.get("api_key"),
        )
        models, added_count = upsert_fetched_llm_models(provider_id, model_names)
        refreshed = get_llm_provider(provider_id)
        return {
            "provider": public_llm_provider(refreshed),
            "models": [public_llm_model(model) for model in models],
            "fetched": len(model_names),
            "added": added_count,
        }
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("获取 LLM 模型列表失败: %s", exc)
        raise HTTPException(status_code=502, detail=f"获取模型列表失败: {exc}") from exc


@app.post("/admin/llm/active")
async def admin_set_active_llm(
    req: LlmActiveRequest,
    admin: dict = Depends(require_admin_user),
):
    try:
        provider = set_active_llm_provider(req.provider_id, req.model_name)
        if not provider:
            raise HTTPException(status_code=404, detail="供应商不存在或已停用")
        return public_llm_provider(provider)
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/llm/test")
async def admin_test_active_llm(admin: dict = Depends(require_admin_user)):
    try:
        result = await llm.test_one_token()
        return {"ok": True, **result}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("LLM 一键测试失败: %s", exc)
        raise HTTPException(status_code=502, detail=f"模型测试失败: {exc}") from exc


@app.get("/admin/users")
async def admin_list_users(
    search: str = "",
    page: int = 1,
    limit: int = 10,
    admin: dict = Depends(require_admin_user),
):
    safe_page = max(page, 1)
    safe_limit = min(max(limit, 1), 100)
    offset = (safe_page - 1) * safe_limit
    try:
        users, total = list_users(search.strip() or None, offset, safe_limit)
        return {
            "users": users,
            "total": total,
            "page": safe_page,
            "pages": math.ceil(total / safe_limit) if total > 0 else 1,
        }
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.patch("/admin/users/{user_id}")
async def admin_update_user(
    user_id: str,
    req: AdminUserUpdateRequest,
    admin: dict = Depends(require_admin_user),
):
    if req.role is not None and req.role not in {"user", "admin"}:
        raise HTTPException(status_code=400, detail="role must be user or admin")
    try:
        target = get_user_by_id(user_id)
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")
        disabling_active_admin = (
            target["role"] == "admin"
            and target["is_active"]
            and (req.is_active is False or req.role == "user")
        )
        if disabling_active_admin and count_active_admins() <= 1:
            raise HTTPException(status_code=400, detail="不能停用最后一个管理员")
        updated = update_user_admin_fields(user_id, role=req.role, is_active=req.is_active)
        if req.is_active is False:
            revoke_user_sessions(user_id)
        return updated
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.post("/admin/users/{user_id}/reset-password")
async def admin_reset_user_password(
    user_id: str,
    req: ResetPasswordRequest,
    admin: dict = Depends(require_admin_user),
):
    validate_email_and_password("admin@example.com", req.password)
    try:
        if not get_user_by_id(user_id):
            raise HTTPException(status_code=404, detail="用户不存在")
        update_user_password(user_id, hash_password(req.password))
        revoke_user_sessions(user_id)
        return {"ok": True}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


@app.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    admin: dict = Depends(require_admin_user),
):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录管理员")
    try:
        target = get_user_by_id(user_id)
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")
        if target["role"] == "admin" and target["is_active"] and count_active_admins() <= 1:
            raise HTTPException(status_code=400, detail="不能删除最后一个管理员")
        if not delete_user(user_id):
            raise HTTPException(status_code=404, detail="用户不存在")
        return {"ok": True}
    except DatabaseError as exc:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from exc


def get_or_fetch_paper_info(paper_id: str) -> dict:
    """Get paper from database, or fetch from OpenReview if not exists."""
    cached = get_paper(paper_id)
    if cached:
        return cached

    # Fetch from OpenReview and save basic info
    paper_info = get_openreview_info(paper_id)
    if not paper_info:
        raise OpenReviewError("Paper not found")

    save_paper(paper_info, llm_response=None)
    return paper_info


@app.get("/paper/{paper_id}/info")
async def get_paper_info(paper_id: str):
    """获取论文基本信息"""
    try:
        paper_info = get_or_fetch_paper_info(paper_id)
    except OpenReviewError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

    if not paper_info:
        raise HTTPException(status_code=404, detail="Paper not found")

    return paper_info


@app.get("/paper/{paper_id}")
async def get_paper_analysis(paper_id: str, reanalyze: bool = False):
    async def generate():
        if not llm.is_configured():
            yield {"event": "error", "data": "config.yaml 未配置有效 LLM API key"}
            return

        # Ensure paper exists in database
        yield {"event": "status", "data": "正在获取论文信息..."}
        try:
            paper_info = await asyncio.to_thread(get_or_fetch_paper_info, paper_id)
        except OpenReviewError as e:
            yield {"event": "error", "data": str(e)}
            return
        except DatabaseError:
            yield {"event": "error", "data": "数据库暂时不可用，请稍后重试"}
            return

        # Check if we can return cached analysis
        if not reanalyze and paper_info.get("llm_response"):
            normalized_response = normalize_llm_markdown(paper_info["llm_response"], analysis_mode=True)
            if normalized_response != paper_info["llm_response"]:
                await asyncio.to_thread(update_llm_response, paper_id, normalized_response)
            yield {"data": normalized_response}
            yield {"event": "done", "data": ""}
            return

        # Perform AI analysis
        yield {"event": "status", "data": "正在读取 PDF 内容..."}
        try:
            paper_content = await asyncio.to_thread(
                get_or_cache_paper_content,
                paper_id,
                paper_info["pdf"],
            )
            paper_content = truncate_content_for_llm(paper_content)
        except ReaderError as e:
            yield {"event": "error", "data": str(e)}
            return

        yield {"event": "status", "data": "正在分析论文..."}

        user_prompt = f"以下是论文内容：\n{paper_content}"

        full_response = []
        async for chunk in llm.get_response_stream(user_prompt):
            full_response.append(chunk)
            yield {"data": chunk}

        normalized_response = normalize_llm_markdown("".join(full_response), analysis_mode=True)
        await asyncio.to_thread(update_llm_response, paper_id, normalized_response)
        yield {"event": "done", "data": ""}

    return EventSourceResponse(generate())


@app.post("/paper/{paper_id}/chat")
async def chat_with_paper(
    paper_id: str,
    req: ChatRequest,
    user: dict = Depends(require_current_user),
):
    ensure_llm_configured()
    session_row = assert_chat_owner(req.session_id, user["id"])
    session = chat_sessions.get(req.session_id)
    is_new_session = session_row is None

    if not session:
        try:
            paper_info = await asyncio.to_thread(get_or_fetch_paper_info, paper_id)
        except OpenReviewError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except DatabaseError as e:
            raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

        context_parts = []
        if paper_info.get("pdf"):
            paper_content = await asyncio.to_thread(
                get_or_cache_paper_content,
                paper_id,
                paper_info["pdf"],
            )
            paper_content = truncate_content_for_llm(paper_content)
            context_parts.append(f"论文全文：\n{paper_content}")
        if paper_info.get("llm_response"):
            context_parts.append(f"论文分析：\n{paper_info['llm_response']}")

        history_rows = get_chat_messages(req.session_id) if session_row else []
        if history_rows:
            history = [{"role": r["role"], "content": r["content"]} for r in history_rows]
        else:
            history = None

        session = ChatSession(llm, context="\n\n".join(context_parts), history=history)
        chat_sessions[req.session_id] = session

    async def generate():
        try:
            if is_new_session:
                create_chat_session(
                    req.session_id,
                    user["id"],
                    paper_id,
                    req.message[:50],
                    account_user_id=user["id"],
                )

            chunks = []
            async for chunk in session.send_stream(req.message):
                chunks.append(chunk)
                yield {"data": chunk}

            # Persist messages
            save_chat_message(req.session_id, "user", req.message)
            save_chat_message(req.session_id, "assistant", normalize_llm_markdown("".join(chunks)))

            yield {"event": "done", "data": ""}
        except DatabaseError:
            yield {"event": "error", "data": "数据库暂时不可用，请稍后重试"}

    return EventSourceResponse(generate())


@app.get("/paper/{paper_id}/chat/sessions")
async def list_chat_sessions(paper_id: str, request: Request):
    try:
        user = get_current_user_optional(request)
        if not user:
            return []
        return get_chat_sessions_for_account(user["id"], paper_id)
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e


@app.get("/chat/{session_id}/messages")
async def list_chat_messages(session_id: str, user: dict = Depends(require_current_user)):
    try:
        assert_chat_owner(session_id, user["id"])
        return get_chat_messages(session_id)
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e


@app.delete("/chat/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(require_current_user)):
    chat_sessions.pop(session_id, None)
    try:
        assert_chat_owner(session_id, user["id"])
        delete_chat_session(session_id)
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e
    return {"ok": True}


@app.post("/paper/{paper_id}/chat/regenerate")
async def regenerate_chat(
    paper_id: str,
    req: ChatRequest,
    user: dict = Depends(require_current_user),
):
    """Delete last message pair, then re-send the user message."""
    ensure_llm_configured()
    session_row = assert_chat_owner(req.session_id, user["id"])
    if not session_row:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = chat_sessions.get(req.session_id)
    if session and len(session.history) >= 2:
        session.history = session.history[:-2]
    else:
        chat_sessions.pop(req.session_id, None)
        session = None

    try:
        delete_last_chat_message_pair(req.session_id)
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

    if not session:
        try:
            paper_info = await asyncio.to_thread(get_or_fetch_paper_info, paper_id)
        except OpenReviewError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except DatabaseError as e:
            raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

        context_parts = []
        if paper_info.get("pdf"):
            paper_content = await asyncio.to_thread(
                get_or_cache_paper_content,
                paper_id,
                paper_info["pdf"],
            )
            paper_content = truncate_content_for_llm(paper_content)
            context_parts.append(f"论文全文：\n{paper_content}")
        if paper_info.get("llm_response"):
            context_parts.append(f"论文分析：\n{paper_info['llm_response']}")
        history_rows = get_chat_messages(req.session_id)
        history = [{"role": r["role"], "content": r["content"]} for r in history_rows] if history_rows else None
        session = ChatSession(llm, context="\n\n".join(context_parts), history=history)
        chat_sessions[req.session_id] = session

    async def generate():
        try:
            chunks = []
            async for chunk in session.send_stream(req.message):
                chunks.append(chunk)
                yield {"data": chunk}

            save_chat_message(req.session_id, "user", req.message)
            save_chat_message(req.session_id, "assistant", "".join(chunks))

            yield {"event": "done", "data": ""}
        except DatabaseError:
            yield {"event": "error", "data": "数据库暂时不可用，请稍后重试"}

    return EventSourceResponse(generate())


@app.get("/conference/{venue}/papers")
async def get_conference_papers_endpoint(
    venue: str,
    page: int = 1,
    limit: int = 8,
    search: str = "",
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True
):
    venue_map = {"neurips_2025": "NeurIPS 2025", "iclr_2026": "ICLR 2026", "icml_2025": "ICML 2025"}
    venue_name = venue_map.get(venue)
    if not venue_name:
        raise HTTPException(status_code=404, detail="Conference not found")

    offset = (page - 1) * limit
    try:
        papers, total = get_conference_papers(
            venue_name, offset, limit,
            search if search else None,
            search_title, search_abstract, search_keywords
        )
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

    return {
        "papers": papers,
        "total": total,
        "page": page,
        "pages": math.ceil(total / limit) if total > 0 else 1
    }


@app.get("/hf-daily-papers")
async def get_hf_daily_papers_endpoint(
    page: int = 1,
    limit: int = 8,
    search: str = "",
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True
):
    safe_page = max(page, 1)
    safe_limit = min(max(limit, 1), 100)
    offset = (safe_page - 1) * safe_limit
    try:
        papers, total = get_hf_daily_papers(
            offset,
            safe_limit,
            search if search else None,
            search_title,
            search_abstract,
            search_keywords,
        )
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

    return {
        "papers": papers,
        "total": total,
        "page": safe_page,
        "pages": math.ceil(total / safe_limit) if total > 0 else 1
    }


@app.get("/search/papers")
async def search_all_papers_endpoint(
    page: int = 1,
    limit: int = 8,
    search: str = "",
    search_title: bool = True,
    search_abstract: bool = True,
    search_keywords: bool = True
):
    offset = (page - 1) * limit
    try:
        papers, total = search_all_papers(
            offset, limit,
            search if search else None,
            search_title, search_abstract, search_keywords
        )
    except DatabaseError as e:
        raise HTTPException(status_code=502, detail="Database temporarily unavailable") from e

    return {
        "papers": papers,
        "total": total,
        "page": page,
        "pages": math.ceil(total / limit) if total > 0 else 1
    }


# 静态文件服务
REACT_FRONTEND_DIST_DIR = Path(__file__).parent.parent / "frontend-react" / "dist"
IMAGES_DIR = Path(__file__).parent.parent / "images"


def get_frontend_index() -> Path:
    react_index = REACT_FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        return react_index
    raise HTTPException(
        status_code=503,
        detail="Frontend build not found. Run `cd frontend-react && npm run build` first.",
    )


app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")
app.mount("/assets", StaticFiles(directory=REACT_FRONTEND_DIST_DIR / "assets", check_dir=False), name="assets")


@app.get("/")
async def serve_frontend():
    return FileResponse(get_frontend_index())


@app.get("/search")
async def serve_search_frontend():
    return FileResponse(get_frontend_index())


@app.get("/login")
async def serve_login_frontend():
    return FileResponse(get_frontend_index())


@app.get("/register")
async def serve_register_frontend():
    return FileResponse(get_frontend_index())


@app.get("/admin")
async def serve_admin_frontend():
    return FileResponse(get_frontend_index())


@app.get("/me")
async def serve_me_frontend():
    return FileResponse(get_frontend_index())


@app.get("/hf-daily")
async def serve_hf_daily_frontend():
    return FileResponse(get_frontend_index())


@app.get("/conference/{venue}")
async def serve_conference_frontend(venue: str):
    return FileResponse(get_frontend_index())


@app.get("/papers/{paper_id}")
async def serve_paper_frontend(paper_id: str):
    return FileResponse(get_frontend_index())
