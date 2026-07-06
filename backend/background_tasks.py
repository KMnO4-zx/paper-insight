import asyncio
import logging
from datetime import datetime, timezone
from analysis_context import build_analysis_prompt
from code_availability import classify_code_availability_from_text
from database import (
    get_papers_pending_keyword_enrichment,
    get_papers_pending_code_availability,
    get_unanalyzed_papers,
    get_paper,
    update_llm_response,
    update_paper_generated_keywords,
    update_paper_code_availability,
)
from keyword_enrichment import extract_keywords_for_paper
from markdown_utils import normalize_llm_markdown
from utils import get_or_cache_paper_content, ReaderError, truncate_content_for_llm

logger = logging.getLogger(__name__)

class BackgroundAnalyzer:
    def __init__(self, llm, check_interval: int = 3600):
        self.llm = llm
        self.check_interval = check_interval
        self.running = False
        self.current_paper_id = None
        self.last_run_started_at = None
        self.last_run_finished_at = None
        self.last_run_success_count = 0
        self.last_run_failed_count = 0
        self.last_run_code_success_count = 0
        self.last_run_code_failed_count = 0
        self.last_run_keyword_success_count = 0
        self.last_run_keyword_failed_count = 0
        self.last_run_error = None
        self.last_analyzed_paper_id = None
        self.current_code_paper_id = None
        self.last_code_checked_paper_id = None
        self.current_keyword_paper_id = None
        self.last_keyword_enriched_paper_id = None
        self._wake_event = asyncio.Event()

    def status_snapshot(self) -> dict:
        return {
            "running": self.running,
            "check_interval_seconds": self.check_interval,
            "current_paper_id": self.current_paper_id,
            "last_run_started_at": self.last_run_started_at,
            "last_run_finished_at": self.last_run_finished_at,
            "last_run_success_count": self.last_run_success_count,
            "last_run_failed_count": self.last_run_failed_count,
            "last_run_code_success_count": self.last_run_code_success_count,
            "last_run_code_failed_count": self.last_run_code_failed_count,
            "last_run_keyword_success_count": self.last_run_keyword_success_count,
            "last_run_keyword_failed_count": self.last_run_keyword_failed_count,
            "last_run_error": self.last_run_error,
            "last_analyzed_paper_id": self.last_analyzed_paper_id,
            "current_code_paper_id": self.current_code_paper_id,
            "last_code_checked_paper_id": self.last_code_checked_paper_id,
            "current_keyword_paper_id": self.current_keyword_paper_id,
            "last_keyword_enriched_paper_id": self.last_keyword_enriched_paper_id,
        }

    def set_check_interval(self, check_interval: int) -> None:
        self.check_interval = check_interval
        self._wake_event.set()

    async def _sleep_until_next_check(self) -> None:
        self._wake_event.clear()
        try:
            await asyncio.wait_for(
                self._wake_event.wait(),
                timeout=max(1, self.check_interval),
            )
        except asyncio.TimeoutError:
            pass

    async def analyze_paper(self, paper_id: str) -> bool:
        """分析单篇论文，返回是否成功"""
        if not self.llm.is_configured():
            logger.warning("LLM 未配置，跳过论文分析: %s", paper_id)
            return False

        max_retries = 3
        self.current_paper_id = paper_id

        try:
            for attempt in range(max_retries):
                try:
                    paper_info = await asyncio.to_thread(get_paper, paper_id)
                    if not paper_info:
                        logger.error(f"论文 {paper_id} 不存在")
                        return False

                    logger.info(f"[{paper_id}] 读取 PDF...")
                    paper_content = None
                    content_error = None
                    if paper_info.get("pdf"):
                        try:
                            paper_content = await asyncio.to_thread(
                                get_or_cache_paper_content,
                                paper_id,
                                paper_info["pdf"],
                            )
                            paper_content = truncate_content_for_llm(paper_content)
                        except ReaderError as e:
                            content_error = str(e)
                            logger.warning(f"[{paper_id}] PDF 读取失败，改用论文元数据分析: {e}")
                    else:
                        content_error = "论文没有可用 PDF 链接"
                        logger.warning(f"[{paper_id}] 未找到 PDF 链接，改用论文元数据分析")

                    logger.info(f"[{paper_id}] 生成分析...")
                    user_prompt = build_analysis_prompt(paper_info, paper_content, content_error)
                    response = await self.llm.get_response(user_prompt)
                    response = normalize_llm_markdown(response, analysis_mode=True)

                    await asyncio.to_thread(update_llm_response, paper_id, response)
                    await self.update_code_availability(paper_info, response)
                    self.last_analyzed_paper_id = paper_id
                    logger.info(f"[{paper_id}] 分析完成: {paper_info.get('title', '')[:50]}")
                    return True

                except Exception as e:
                    logger.warning(f"[{paper_id}] 分析失败 (尝试 {attempt + 1}/{max_retries}): {e}")

                if attempt < max_retries - 1:
                    await asyncio.sleep(2)

            logger.error(f"[{paper_id}] 分析失败，已重试 {max_retries} 次")
            return False
        finally:
            self.current_paper_id = None

    async def update_code_availability(self, paper_info: dict, llm_response: str | None) -> bool:
        paper_id = paper_info.get("id")
        if not paper_id:
            return False
        if not llm_response:
            logger.info("[%s] 没有 llm_response，跳过代码开源状态判断", paper_id)
            return False

        self.current_code_paper_id = paper_id
        try:
            result = await classify_code_availability_from_text(
                self.llm,
                paper_info,
                llm_response,
                source="llm_response",
            )
            await asyncio.to_thread(
                update_paper_code_availability,
                paper_id,
                result["status"],
                result.get("code_url"),
                result.get("evidence"),
                result.get("meta"),
            )
            logger.info("[%s] 代码开源状态判断完成: %s", paper_id, result["status"])
            self.last_code_checked_paper_id = paper_id
            return True
        except Exception as exc:
            logger.warning("[%s] 代码开源状态判断失败: %s", paper_id, exc)
            return False
        finally:
            self.current_code_paper_id = None

    async def update_keywords(self, paper_info: dict) -> bool:
        paper_id = paper_info.get("id")
        if not paper_id:
            return False

        self.current_keyword_paper_id = paper_id
        try:
            result = await extract_keywords_for_paper(self.llm, paper_info)
            await asyncio.to_thread(
                update_paper_generated_keywords,
                paper_id,
                result.get("keywords") or [],
                "generated",
                result.get("meta"),
            )
            logger.info("[%s] 关键词补全完成: %s", paper_id, ", ".join(result.get("keywords") or []))
            self.last_keyword_enriched_paper_id = paper_id
            return True
        except Exception as exc:
            logger.warning("[%s] 关键词补全失败: %s", paper_id, exc)
            return False
        finally:
            self.current_keyword_paper_id = None

    async def run(self):
        """主循环：每小时检查一次"""
        self.running = True
        logger.info(f"后台分析任务启动，检查间隔: {self.check_interval}秒")

        while self.running:
            try:
                self.last_run_started_at = datetime.now(timezone.utc)
                self.last_run_finished_at = None
                self.last_run_success_count = 0
                self.last_run_failed_count = 0
                self.last_run_code_success_count = 0
                self.last_run_code_failed_count = 0
                self.last_run_keyword_success_count = 0
                self.last_run_keyword_failed_count = 0
                self.last_run_error = None

                if not self.llm.is_configured():
                    logger.warning("LLM 未配置，跳过本轮后台分析")
                    self.last_run_error = "LLM is not configured"
                    self.last_run_finished_at = datetime.now(timezone.utc)
                    await self._sleep_until_next_check()
                    continue

                papers = await asyncio.to_thread(get_unanalyzed_papers, limit=10)

                if papers:
                    logger.info(f"发现 {len(papers)} 篇未分析论文，开始处理...")

                    for paper in papers:
                        if not self.running:
                            break

                        ok = await self.analyze_paper(paper["id"])
                        if ok:
                            self.last_run_success_count += 1
                        else:
                            self.last_run_failed_count += 1
                        await asyncio.sleep(1)

                    logger.info("本轮处理完成")
                else:
                    logger.info("没有未分析的论文")

                pending_code_papers = await asyncio.to_thread(get_papers_pending_code_availability, limit=10)
                if pending_code_papers:
                    logger.info("发现 %s 篇待判断代码开源状态的论文，开始处理...", len(pending_code_papers))
                    for paper in pending_code_papers:
                        if not self.running:
                            break
                        ok = await self.update_code_availability(paper, paper.get("llm_response"))
                        if ok:
                            self.last_run_code_success_count += 1
                        else:
                            self.last_run_code_failed_count += 1
                        await asyncio.sleep(1)

                pending_keyword_papers = await asyncio.to_thread(get_papers_pending_keyword_enrichment, limit=10)
                if pending_keyword_papers:
                    logger.info("发现 %s 篇待补全关键词的论文，开始处理...", len(pending_keyword_papers))
                    for paper in pending_keyword_papers:
                        if not self.running:
                            break
                        ok = await self.update_keywords(paper)
                        if ok:
                            self.last_run_keyword_success_count += 1
                        else:
                            self.last_run_keyword_failed_count += 1
                        await asyncio.sleep(1)

            except Exception as e:
                self.last_run_error = str(e)[:500]
                logger.error(f"后台任务异常: {e}")
            finally:
                self.last_run_finished_at = datetime.now(timezone.utc)

            await self._sleep_until_next_check()

    def stop(self):
        """停止后台任务"""
        self.running = False
        self._wake_event.set()
        logger.info("后台分析任务停止")
