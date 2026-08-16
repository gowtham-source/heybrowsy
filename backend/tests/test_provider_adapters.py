import json
from types import SimpleNamespace
from heybrowsy.config import Settings
from heybrowsy.models import SpeedMode
from heybrowsy.provider import AnthropicProvider, GeminiProvider, ProviderRouter


DECISION = json.dumps({
    "analysis": "Read the current page",
    "action": {
        "id": "a1", "type": "read_page", "element_id": None, "value": None,
        "url": None, "direction": None, "amount": None,
        "rationale": "Refresh context", "expected_change": "A current snapshot",
    },
    "answer": None,
    "confidence": 0.9,
})


class CaptureCreate:
    def __init__(self, response):
        self.response = response
        self.kwargs = None

    async def __call__(self, **kwargs):
        self.kwargs = kwargs
        return self.response


async def test_anthropic_adapter_uses_native_structured_output():
    capture = CaptureCreate(SimpleNamespace(content=[SimpleNamespace(type="text", text=DECISION)]))
    provider = AnthropicProvider.__new__(AnthropicProvider)
    provider.settings = Settings(_env_file=None, anthropic_api_key="test")
    provider.client = SimpleNamespace(messages=SimpleNamespace(create=capture))

    decision = await provider.decide(goal="Read", mode=SpeedMode.balanced, context={}, history=[])

    assert capture.kwargs["model"] == "claude-sonnet-5"
    assert capture.kwargs["output_config"]["format"]["type"] == "json_schema"
    assert capture.kwargs["system"]
    assert decision.provider == "anthropic"


async def test_gemini_adapter_uses_interactions_thinking_and_schema():
    capture = CaptureCreate(SimpleNamespace(output_text=DECISION))
    provider = GeminiProvider.__new__(GeminiProvider)
    provider.settings = Settings(_env_file=None, gemini_api_key="test")
    provider.client = SimpleNamespace(aio=SimpleNamespace(interactions=SimpleNamespace(create=capture)))

    decision = await provider.decide(goal="Read", mode=SpeedMode.accurate, context={}, history=[])

    assert capture.kwargs["model"] == "gemini-3.6-flash"
    assert capture.kwargs["generation_config"]["thinking_level"] == "high"
    assert capture.kwargs["response_format"]["mime_type"] == "application/json"
    assert capture.kwargs["system_instruction"]
    assert decision.provider == "gemini"


class StubProvider:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    async def decide(self, **_):
        if self.error:
            raise self.error
        return self.result


async def test_router_falls_back_to_next_configured_provider():
    expected = SimpleNamespace(provider="gemini")
    router = ProviderRouter.__new__(ProviderRouter)
    router.settings = Settings(_env_file=None, openai_api_key="one", gemini_api_key="two")
    router.providers = {
        "openai": StubProvider(error=TimeoutError("slow")),
        "gemini": StubProvider(result=expected),
    }
    router.demo = StubProvider()

    result = await router.decide(goal="Read", mode=SpeedMode.fast, context={}, history=[])
    assert result is expected

