import json
import io
import os
import requests
import logging
import re
import tiktoken
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from config import settings
from pypdf import PdfReader
from pypdf.errors import PdfReadError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TIMEOUT = 30
MAX_RETRIES = 3
LLM_CONTENT_TOKEN_LIMIT = 180000
MIN_EXTRACTED_PDF_TEXT_CHARS = 200
_TOKEN_ENCODING = tiktoken.get_encoding("cl100k_base")
BLOCKED_READER_MARKERS = (
    "performing security verification",
    "this website uses a security service to protect against malicious bots",
    "target url returned error 403: forbidden",
    "this page maybe requiring captcha",
    "enable javascript and cookies to continue",
)

HEADERS = {
    "Accept": "application/json,text/*;q=0.99",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "Referer": "https://openreview.net/",
    "Origin": "https://openreview.net"
}
PDF_HEADERS = {
    "Accept": "application/pdf,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": HEADERS["User-Agent"],
}

DEFAULT_PAPER_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "paper_cache"
OPENREVIEW_PDF_URL_PREFIX = "https://openreview.net/pdf?id="
_OPENREVIEW_URL_PATTERN = re.compile(r"^https://openreview\.net/(?:attachment|pdf)\?")


class ReaderError(Exception):
    """Jina Reader 请求失败"""
    pass


class OpenReviewError(Exception):
    """OpenReview API 请求失败"""
    pass


def get_openreview_pdf_url(paper_id: str) -> str:
    return f"{OPENREVIEW_PDF_URL_PREFIX}{paper_id}"


def normalize_paper_pdf_url(paper_id: str, pdf_url: str | None) -> str | None:
    if pdf_url is None:
        return None

    normalized_url = pdf_url.strip()
    if not normalized_url:
        return None

    # Normalize all OpenReview PDF variants to one canonical form so DB rows
    # and cache metadata stay stable.
    if _OPENREVIEW_URL_PATTERN.match(normalized_url):
        return get_openreview_pdf_url(paper_id)

    return normalized_url


def _get_paper_cache_dir() -> Path:
    configured_dir = settings.paths.paper_content_cache_dir
    if configured_dir:
        configured_path = Path(configured_dir)
        return configured_path if configured_path.is_absolute() else Path(__file__).resolve().parent.parent / configured_path
    return DEFAULT_PAPER_CACHE_DIR


def _get_paper_cache_paths(paper_id: str) -> tuple[Path, Path]:
    safe_paper_id = re.sub(r"[^A-Za-z0-9._-]", "_", paper_id)
    cache_dir = _get_paper_cache_dir()
    return (
        cache_dir / f"{safe_paper_id}.txt",
        cache_dir / f"{safe_paper_id}.meta.json",
    )


def has_cached_paper_content(paper_id: str, pdf_url: str | None = None) -> bool:
    pdf_url = normalize_paper_pdf_url(paper_id, pdf_url)
    content_path, meta_path = _get_paper_cache_paths(paper_id)
    if not content_path.exists():
        return False

    try:
        if content_path.stat().st_size <= 0:
            return False
    except OSError:
        return False

    if pdf_url and meta_path.exists():
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("论文正文缓存元数据损坏，忽略缓存: %s", meta_path)
            return False

        cached_pdf_url = normalize_paper_pdf_url(paper_id, metadata.get("pdf_url"))
        if cached_pdf_url and cached_pdf_url != pdf_url:
            logger.info("论文 %s 的 PDF 地址已变化，重新抓取正文缓存", paper_id)
            return False

    return True


def get_cached_paper_content(paper_id: str, pdf_url: str | None = None) -> str | None:
    pdf_url = normalize_paper_pdf_url(paper_id, pdf_url)
    content_path, _ = _get_paper_cache_paths(paper_id)
    if not has_cached_paper_content(paper_id, pdf_url):
        logger.info("论文正文缓存未命中: %s", paper_id)
        return None

    try:
        content = content_path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("读取论文正文缓存失败 %s: %s", content_path, exc)
        return None

    if not content.strip():
        logger.warning("论文正文缓存为空，忽略缓存: %s", content_path)
        return None

    if is_blocked_reader_content(content):
        logger.warning("论文正文缓存疑似为访问验证页，忽略缓存: %s", content_path)
        return None

    logger.info("论文正文缓存命中: %s", paper_id)
    return content


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp_path.write_text(content, encoding="utf-8")
    tmp_path.replace(path)


def cache_paper_content(paper_id: str, pdf_url: str, content: str, source: str = "jina_reader") -> None:
    if not content.strip():
        logger.warning("论文正文为空，跳过缓存: %s", paper_id)
        return

    if is_blocked_reader_content(content):
        logger.warning("论文正文疑似为访问验证页，跳过缓存: %s", paper_id)
        return

    normalized_pdf_url = normalize_paper_pdf_url(paper_id, pdf_url) or pdf_url
    content_path, meta_path = _get_paper_cache_paths(paper_id)
    metadata = {
        "paper_id": paper_id,
        "pdf_url": normalized_pdf_url,
        "source": source,
        "cached_at": datetime.now(timezone.utc).isoformat(),
        "size_bytes": len(content.encode("utf-8")),
    }

    try:
        _atomic_write_text(content_path, content)
        _atomic_write_text(
            meta_path,
            json.dumps(metadata, ensure_ascii=False, indent=2),
        )
        logger.info("已缓存论文正文: %s -> %s", paper_id, content_path)
    except OSError as exc:
        logger.warning("写入论文正文缓存失败 %s: %s", content_path, exc)


def get_or_cache_paper_content(paper_id: str, pdf_url: str) -> str:
    normalized_pdf_url = normalize_paper_pdf_url(paper_id, pdf_url) or pdf_url
    cached_content = get_cached_paper_content(paper_id, normalized_pdf_url)
    if cached_content is not None:
        return cached_content

    source = "jina_reader"
    try:
        content = reader(normalized_pdf_url)
    except ReaderError as jina_error:
        if not _looks_like_pdf_url(normalized_pdf_url):
            raise
        logger.warning(
            "Jina Reader 读取失败，改用本地 PDF 文本抽取: paper_id=%s url=%s error=%s",
            paper_id,
            normalized_pdf_url,
            jina_error,
        )
        try:
            content = extract_pdf_text_from_url(normalized_pdf_url)
            source = "pdf_text_extractor"
        except ReaderError as pdf_error:
            raise ReaderError(f"{jina_error}；PDF 直连解析也失败: {pdf_error}") from pdf_error

    cache_paper_content(paper_id, normalized_pdf_url, content, source=source)
    return content


def truncate_content_for_llm(text: str, max_tokens: int = LLM_CONTENT_TOKEN_LIMIT) -> str:
    # Some PDFs contain strings like "<|endoftext|>" literally.
    # They should be treated as normal text instead of special tokens.
    token_ids = _TOKEN_ENCODING.encode(text, disallowed_special=())
    token_count = len(token_ids)

    if token_count <= max_tokens:
        logger.info(f"LLM content within token limit: {token_count} <= {max_tokens}")
        return text

    truncated_text = _TOKEN_ENCODING.decode(token_ids[:max_tokens])
    logger.warning(
        "LLM content truncated by tokens: original=%s, kept=%s",
        token_count,
        max_tokens,
    )
    return truncated_text


def reader(url: str) -> str:
    target_url = "https://r.jina.ai/"
    last_error: str | None = None

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                target_url,
                json={"url": url},
                headers=_reader_request_headers(),
                timeout=TIMEOUT,
            )
            response.raise_for_status()
            content = response.text
            if is_blocked_reader_content(content):
                raise ReaderError(f"目标页面被访问验证或反爬拦截，未获取到论文正文: {url}")
            return content
        except requests.Timeout:
            last_error = "请求超时"
            logger.warning(f"Jina Reader 超时 (尝试 {attempt + 1}/{MAX_RETRIES})")
        except requests.RequestException as e:
            last_error = str(e)
            logger.warning(f"Jina Reader 请求失败: {e} (尝试 {attempt + 1}/{MAX_RETRIES})")

        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt)

    detail = f"（最后错误：{last_error}）" if last_error else ""
    raise ReaderError(f"Jina Reader 请求失败，已重试 {MAX_RETRIES} 次: {url}{detail}")


def is_blocked_reader_content(content: str) -> bool:
    normalized = " ".join(content.casefold().split())
    return any(marker in normalized for marker in BLOCKED_READER_MARKERS)


def _reader_request_headers() -> dict[str, str]:
    return {
        "Accept": "text/markdown,text/plain,text/*;q=0.9,*/*;q=0.8",
        "Accept-Language": PDF_HEADERS["Accept-Language"],
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"],
    }


def _pdf_request_headers(url: str) -> dict[str, str]:
    headers = dict(PDF_HEADERS)
    parsed = urlparse(url)
    host = parsed.netloc.casefold()
    if host.endswith("dl.acm.org"):
        headers["Referer"] = "https://dl.acm.org/"
    elif host.endswith("openreview.net"):
        headers["Referer"] = "https://openreview.net/"
        headers["Origin"] = "https://openreview.net"
    elif parsed.scheme and parsed.netloc:
        headers["Referer"] = f"{parsed.scheme}://{parsed.netloc}/"
    return headers


def _looks_like_pdf_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower().rstrip("/")
    return path.endswith(".pdf") or path.endswith("/pdf") or "/pdf/" in path


def extract_pdf_text_from_url(url: str) -> str:
    last_error: str | None = None

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=_pdf_request_headers(url), timeout=TIMEOUT)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "pdf" not in content_type.lower() and not response.content.startswith(b"%PDF"):
                raise ReaderError(f"URL 返回的不是 PDF: content-type={content_type or 'unknown'}")
            return extract_pdf_text(response.content, url)
        except ReaderError:
            raise
        except requests.Timeout:
            last_error = "请求超时"
            logger.warning(f"PDF 下载超时 (尝试 {attempt + 1}/{MAX_RETRIES}): {url}")
        except requests.RequestException as e:
            last_error = str(e)
            logger.warning(f"PDF 下载失败: {e} (尝试 {attempt + 1}/{MAX_RETRIES}): {url}")

        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt)

    detail = f"（最后错误：{last_error}）" if last_error else ""
    raise ReaderError(f"PDF 下载失败，已重试 {MAX_RETRIES} 次: {url}{detail}")


def extract_pdf_text(pdf_bytes: bytes, source_url: str = "") -> str:
    try:
        pdf = PdfReader(io.BytesIO(pdf_bytes))
    except PdfReadError as exc:
        raise ReaderError(f"PDF 解析失败: {source_url or 'unknown source'}") from exc

    if pdf.is_encrypted:
        try:
            pdf.decrypt("")
        except Exception as exc:
            raise ReaderError(f"PDF 加密且无法解密: {source_url or 'unknown source'}") from exc

    pages: list[str] = []
    for index, page in enumerate(pdf.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception as exc:
            logger.warning("PDF 第 %s 页文本抽取失败: %s", index, exc)
            continue
        page_text = page_text.strip()
        if page_text:
            pages.append(page_text)

    content = "\n\n".join(pages).strip()
    if len(content) < MIN_EXTRACTED_PDF_TEXT_CHARS:
        raise ReaderError(f"PDF 文本抽取结果过短: {source_url or 'unknown source'}")
    return content

def get_openreview_info(paper_id: str) -> dict | None:
    url = f"https://api2.openreview.net/notes?id={paper_id}"

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

            if not data.get("notes"):
                return None

            note = data["notes"][0]
            content = note.get("content", {})

            return {
                "id": note.get("id"),
                "title": content.get("title", {}).get("value"),
                "abstract": content.get("abstract", {}).get("value"),
                "authors": content.get("authors", {}).get("value", []),
                "keywords": content.get("keywords", {}).get("value", []),
                "primary_area": content.get("primary_area", {}).get("value"),
                "venue": content.get("venue", {}).get("value"),
                "pdf": get_openreview_pdf_url(note["id"]),
            }
        except requests.Timeout:
            logger.warning(f"OpenReview API 超时 (尝试 {attempt + 1}/{MAX_RETRIES})")
        except requests.RequestException as e:
            logger.warning(f"OpenReview API 请求失败: {e} (尝试 {attempt + 1}/{MAX_RETRIES})")

        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt)

    raise OpenReviewError(f"OpenReview API 请求失败，已重试 {MAX_RETRIES} 次: {paper_id}")



if __name__ == "__main__":
    sample_url = "https://openreview.net/pdf?id=uq6UWRgzMr"
    # content = reader(sample_url)
    # print(content)

    # paper_id = "uq6UWRgzMr"
    # info = get_openreview_info(paper_id)
    # print(info)
