from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError
import asyncio
import logging
from config import settings
from prompt import PAPER_ANALYSIS_PROMPT

MISSING_API_KEY_PLACEHOLDER = "missing-api-key"
logger = logging.getLogger(__name__)

async def retry_on_error(func, max_retries=3, delay=1.0):
    """Simple retry wrapper for async functions"""
    for attempt in range(max_retries):
        try:
            return await func()
        except (APIError, APITimeoutError, RateLimitError) as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))

class BaseLLM:
    def __init__(self, model: str, api_key: str = None, base_url: str = None):
        self.api_key = api_key if api_key else settings.llm.openai_api_key
        self.model = model
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=base_url)

    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_key != MISSING_API_KEY_PLACEHOLDER)

    async def get_response(self, prompt: str, **kwargs) -> str:
        async def _call():
            response = await self.client.chat.completions.create(
                model=self.model,
                temperature=1.0,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for academic research."},
                    {"role": "user", "content": prompt + "\n\n" + PAPER_ANALYSIS_PROMPT}
                ],
            **kwargs)
            return response.choices[0].message.content
        return await retry_on_error(_call)

    async def get_response_stream(self, prompt: str, **kwargs):
        response = await self.client.chat.completions.create(
            model=self.model,
            temperature=1.0,
            stream=True,
            messages=[
                {"role": "system", "content": "You are a helpful assistant for academic research."},
                {"role": "user", "content": prompt + "\n\n" + PAPER_ANALYSIS_PROMPT}
            ],
        **kwargs
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def chat(self, messages: list, **kwargs) -> str:
        async def _call():
            response = await self.client.chat.completions.create(
                model=self.model,
                temperature=1.0,
                messages=messages,
                **kwargs
            )
            return response.choices[0].message.content
        return await retry_on_error(_call)

    async def chat_stream(self, messages: list, **kwargs):
        response = await self.client.chat.completions.create(
            model=self.model,
            temperature=1.0,
            stream=True,
            messages=messages,
            **kwargs
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


class ManagedLLM:
    def _get_active_config(self) -> dict | None:
        from database import get_active_llm_config

        return get_active_llm_config()

    def is_configured(self) -> bool:
        try:
            config = self._get_active_config()
        except Exception as exc:
            logger.warning("LLM 配置读取失败: %s", exc)
            return False
        return bool(config and config.get("api_key") and config.get("model_name") and config.get("base_url"))

    def _client_for_config(self, config: dict) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=config.get("api_key") or MISSING_API_KEY_PLACEHOLDER,
            base_url=config.get("base_url"),
        )

    def _default_parameters(self, config: dict) -> dict:
        params = config.get("default_parameters") or {}
        return params if isinstance(params, dict) else {}

    def _require_config(self) -> dict:
        config = self._get_active_config()
        if not config or not config.get("api_key"):
            raise RuntimeError("LLM API key is not configured")
        if not config.get("model_name"):
            raise RuntimeError("LLM model is not configured")
        if not config.get("base_url"):
            raise RuntimeError("LLM base URL is not configured")
        return config

    def _parameters(self, config: dict, overrides: dict) -> dict:
        params = self._default_parameters(config)
        params.update(overrides)
        return params

    async def get_response(self, prompt: str, **kwargs) -> str:
        config = self._require_config()
        client = self._client_for_config(config)
        params = self._parameters(config, kwargs)

        async def _call():
            response = await client.chat.completions.create(
                model=config["model_name"],
                temperature=1.0,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for academic research."},
                    {"role": "user", "content": prompt + "\n\n" + PAPER_ANALYSIS_PROMPT},
                ],
                **params,
            )
            return response.choices[0].message.content

        return await retry_on_error(_call)

    async def get_response_stream(self, prompt: str, **kwargs):
        config = self._require_config()
        client = self._client_for_config(config)
        params = self._parameters(config, kwargs)
        response = await client.chat.completions.create(
            model=config["model_name"],
            temperature=1.0,
            stream=True,
            messages=[
                {"role": "system", "content": "You are a helpful assistant for academic research."},
                {"role": "user", "content": prompt + "\n\n" + PAPER_ANALYSIS_PROMPT},
            ],
            **params,
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def chat(self, messages: list, **kwargs) -> str:
        config = self._require_config()
        client = self._client_for_config(config)
        params = self._parameters(config, kwargs)

        async def _call():
            response = await client.chat.completions.create(
                model=config["model_name"],
                temperature=1.0,
                messages=messages,
                **params,
            )
            return response.choices[0].message.content

        return await retry_on_error(_call)

    async def chat_stream(self, messages: list, **kwargs):
        config = self._require_config()
        client = self._client_for_config(config)
        params = self._parameters(config, kwargs)
        response = await client.chat.completions.create(
            model=config["model_name"],
            temperature=1.0,
            stream=True,
            messages=messages,
            **params,
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def test_one_token(self) -> dict:
        config = self._require_config()
        client = self._client_for_config(config)
        messages = [{"role": "user", "content": "Output exactly one digit."}]
        base_params = self._default_parameters(config)

        async def _call(params: dict):
            response = await client.chat.completions.create(
                model=config["model_name"],
                temperature=0,
                messages=messages,
                **params,
            )
            return response.choices[0].message.content or ""

        try:
            params = {**base_params, "max_tokens": 1}
            params.pop("max_completion_tokens", None)
            output = await retry_on_error(lambda: _call(params), max_retries=1)
        except Exception:
            params = {**base_params, "max_completion_tokens": 1}
            params.pop("max_tokens", None)
            output = await retry_on_error(lambda: _call(params), max_retries=1)

        return {
            "provider_id": str(config["id"]),
            "provider_name": config["name"],
            "model_name": config["model_name"],
            "output": output,
        }


async def fetch_openai_compatible_model_names(base_url: str, api_key: str | None) -> list[str]:
    client = AsyncOpenAI(
        api_key=(api_key or MISSING_API_KEY_PLACEHOLDER),
        base_url=base_url.strip().rstrip("/"),
    )
    response = await client.models.list()
    names: list[str] = []
    for item in response.data:
        model_id = getattr(item, "id", None)
        if not model_id and isinstance(item, dict):
            model_id = item.get("id")
        if model_id:
            names.append(str(model_id))
    return sorted(set(names))
    
class SiliconflowLLM(BaseLLM):
    def __init__(self, api_key: str = None, base_url: str = None, model: str = "Pro/MiniMaxAI/MiniMax-M2.5"):
        self.api_key = api_key if api_key else settings.llm.siliconflow_api_key
        self.base_url = base_url if base_url else "https://api.siliconflow.cn/v1"
        self.model = model
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=self.base_url)

class OpenRouterLLM(BaseLLM):
    def __init__(self, api_key: str = None, base_url: str = None, model: str = "stepfun/step-3.5-flash:free", max_completion_tokens: int = 12000):
        self.api_key = api_key if api_key else settings.llm.open_router_api_key
        self.base_url = base_url if base_url else "https://openrouter.ai/api/v1"
        self.model = model
        self.max_completion_tokens = max_completion_tokens
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=self.base_url)

    async def get_response(self, prompt: str, **kwargs) -> str:
        kwargs.setdefault('max_completion_tokens', self.max_completion_tokens)
        return await super().get_response(prompt, **kwargs)

    async def get_response_stream(self, prompt: str, **kwargs):
        kwargs.setdefault('max_completion_tokens', self.max_completion_tokens)
        async for chunk in super().get_response_stream(prompt, **kwargs):
            yield chunk

    async def chat(self, messages: list, **kwargs) -> str:
        kwargs.setdefault('max_completion_tokens', self.max_completion_tokens)
        return await super().chat(messages, **kwargs)

    async def chat_stream(self, messages: list, **kwargs):
        kwargs.setdefault('max_completion_tokens', self.max_completion_tokens)
        async for chunk in super().chat_stream(messages, **kwargs):
            yield chunk

class StepLLM(BaseLLM):
    def __init__(self, api_key: str = None, base_url: str = None, model: str = "step-3.5-flash-2603"):
        self.api_key = api_key if api_key else settings.llm.step_api_key
        self.base_url = base_url if base_url else settings.llm.step_base_url
        self.model = model
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=self.base_url)

class ArkPlanLLM(BaseLLM):
    def __init__(self, api_key: str = None, base_url: str = None, model: str = "ark-code-latest"):
        self.api_key = api_key if api_key else settings.llm.arkplan_api_key
        self.base_url = base_url if base_url else "https://ark.cn-beijing.volces.com/api/coding/v3"
        self.model = model
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=self.base_url)

class DeepSeekLLM(BaseLLM):
    def __init__(self, api_key: str = None, base_url: str = None, model: str = "deepseek-v4-flash"):
        self.api_key = api_key if api_key else settings.llm.deepseek_api_key
        self.base_url = base_url if base_url else "https://api.deepseek.com"
        self.model = model
        self.client = AsyncOpenAI(api_key=self.api_key or MISSING_API_KEY_PLACEHOLDER, base_url=self.base_url)

if __name__ == "__main__":
    import asyncio

    async def test():
        try:
            llm = StepLLM()
            print(f"API Key configured: {bool(llm.api_key)}")
            print(f"Base URL: {llm.base_url}")
            print(f"Model: {llm.model}")

            prompt = "请简要介绍一下Transformer模型。"

            # 测试非流式响应
            print("\n开始测试非流式响应...")
            response = await llm.get_response(prompt)
            print("Response:", response)

            # 测试流式响应
            print("\n开始测试流式响应...")
            print("Streamed Response:", end=" ")
            async for chunk in llm.get_response_stream(prompt):
                print(chunk, end="", flush=True)
            print("\n\n测试完成！")
        except Exception as e:
            print(f"错误: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()

    asyncio.run(test())
