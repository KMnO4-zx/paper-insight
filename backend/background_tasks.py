import asyncio
import logging
from database import get_unanalyzed_papers, get_paper, update_llm_response
from markdown_utils import normalize_llm_markdown
from utils import get_or_cache_paper_content, ReaderError, truncate_content_for_llm

logger = logging.getLogger(__name__)

class BackgroundAnalyzer:
    def __init__(self, llm, check_interval: int = 3600):
        self.llm = llm
        self.check_interval = check_interval
        self.running = False

    async def analyze_paper(self, paper_id: str) -> bool:
        """分析单篇论文，返回是否成功"""
        if not self.llm.is_configured():
            logger.warning("LLM 未配置，跳过论文分析: %s", paper_id)
            return False

        max_retries = 3

        for attempt in range(max_retries):
            try:
                paper_info = await asyncio.to_thread(get_paper, paper_id)
                if not paper_info:
                    logger.error(f"论文 {paper_id} 不存在")
                    return False

                logger.info(f"[{paper_id}] 读取 PDF...")
                paper_content = await asyncio.to_thread(
                    get_or_cache_paper_content,
                    paper_id,
                    paper_info["pdf"],
                )
                paper_content = truncate_content_for_llm(paper_content)

                logger.info(f"[{paper_id}] 生成分析...")
                user_prompt = f"以下是论文内容：\n{paper_content}"
                response = await self.llm.get_response(user_prompt)
                response = normalize_llm_markdown(response, analysis_mode=True)

                await asyncio.to_thread(update_llm_response, paper_id, response)
                logger.info(f"[{paper_id}] 分析完成: {paper_info.get('title', '')[:50]}")
                return True

            except ReaderError as e:
                logger.warning(f"[{paper_id}] PDF 读取失败 (尝试 {attempt + 1}/{max_retries}): {e}")
            except Exception as e:
                logger.warning(f"[{paper_id}] 分析失败 (尝试 {attempt + 1}/{max_retries}): {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(2)

        logger.error(f"[{paper_id}] 分析失败，已重试 {max_retries} 次")
        return False

    async def run(self):
        """主循环：每小时检查一次"""
        self.running = True
        logger.info(f"后台分析任务启动，检查间隔: {self.check_interval}秒")

        while self.running:
            try:
                if not self.llm.is_configured():
                    logger.warning("LLM 未配置，跳过本轮后台分析")
                    await asyncio.sleep(self.check_interval)
                    continue

                papers = await asyncio.to_thread(get_unanalyzed_papers, limit=10)

                if papers:
                    logger.info(f"发现 {len(papers)} 篇未分析论文，开始处理...")

                    for paper in papers:
                        if not self.running:
                            break

                        await self.analyze_paper(paper["id"])
                        await asyncio.sleep(1)

                    logger.info("本轮处理完成")
                else:
                    logger.info("没有未分析的论文")

            except Exception as e:
                logger.error(f"后台任务异常: {e}")

            await asyncio.sleep(self.check_interval)

    def stop(self):
        """停止后台任务"""
        self.running = False
        logger.info("后台分析任务停止")
