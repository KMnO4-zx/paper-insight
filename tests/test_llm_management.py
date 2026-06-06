from types import SimpleNamespace

import pytest

from llm import ManagedLLM
from app import public_active_llm_config


class FakeCompletions:
    def __init__(self, fail_first: bool = False):
        self.calls = []
        self.fail_first = fail_first

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail_first and len(self.calls) == 1:
            raise ValueError("max_tokens unsupported")
        return SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content="7")),
            ],
        )


class FakeClient:
    def __init__(self, completions: FakeCompletions):
        self.chat = SimpleNamespace(completions=completions)


def managed_llm_with_fake_client(completions: FakeCompletions) -> ManagedLLM:
    llm = ManagedLLM()
    llm._get_active_config = lambda: {
        "id": "provider-1",
        "name": "Test Provider",
        "base_url": "https://example.test/v1",
        "api_key": "test-key",
        "model_name": "test-model",
        "default_parameters": {},
    }
    llm._client_for_config = lambda config: FakeClient(completions)
    return llm


def test_public_active_llm_config_exposes_display_fields_only():
    payload = public_active_llm_config(
        {
            "provider_key": "deepseek",
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com",
            "api_key": "secret-key",
            "model_name": "deepseek-v4-pro",
        }
    )

    assert payload == {
        "configured": True,
        "provider_key": "deepseek",
        "provider_name": "DeepSeek",
        "model_name": "deepseek-v4-pro",
    }
    assert "api_key" not in payload
    assert "base_url" not in payload


@pytest.mark.asyncio
async def test_one_token_uses_max_tokens_limit():
    completions = FakeCompletions()
    llm = managed_llm_with_fake_client(completions)

    result = await llm.test_one_token()

    assert result["provider_name"] == "Test Provider"
    assert result["model_name"] == "test-model"
    assert result["output"] == "7"
    assert completions.calls[0]["max_tokens"] == 1


@pytest.mark.asyncio
async def test_one_token_falls_back_to_max_completion_tokens():
    completions = FakeCompletions(fail_first=True)
    llm = managed_llm_with_fake_client(completions)

    result = await llm.test_one_token()

    assert result["output"] == "7"
    assert completions.calls[0]["max_tokens"] == 1
    assert completions.calls[1]["max_completion_tokens"] == 1
