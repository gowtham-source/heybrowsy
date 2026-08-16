"""Low-cost live provider smoke test. Never prints credentials or response content."""

import asyncio
import json
import sys
import time

from heybrowsy.config import Settings
from heybrowsy.models import SpeedMode
from heybrowsy.provider import ProviderRouter


CONTEXT = {
    "url": "https://example.com",
    "title": "Example Domain",
    "selected_text": "",
    "visible_text": "Example Domain. This domain is for use in illustrative examples.",
    "interactive_elements": [],
    "viewport": {"width": 1280, "height": 720, "scrollX": 0, "scrollY": 0},
    "fingerprint": "provider-smoke-test",
    "security": {"page_is_untrusted": True, "possible_prompt_injection": False},
}


async def check(provider_name: str) -> dict:
    settings = Settings(
        fast_provider=provider_name,
        provider_fallbacks=False,
    )
    if provider_name not in settings.configured_provider_names():
        return {"provider": provider_name, "ok": False, "error": "API key is not configured"}

    router = ProviderRouter(settings)
    model = settings.model_for(provider_name, "fast")
    if "fable" in model.lower():
        await router.close()
        return {"provider": provider_name, "ok": False, "error": "Refused expensive Fable model"}

    started = time.perf_counter()
    try:
        decision = await router.decide(
            goal="Read this page and choose the safest next browser action.",
            mode=SpeedMode.fast,
            context=CONTEXT,
            history=[],
        )
        return {
            "provider": decision.provider,
            "model": decision.model,
            "ok": True,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "schema_valid": decision.action.type in {"click", "type", "navigate", "scroll", "select", "read_page", "finish"},
            "action_type": decision.action.type,
            "confidence": decision.confidence,
        }
    except Exception as exc:
        return {
            "provider": provider_name,
            "model": model,
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "error_type": type(exc).__name__,
            "error": str(exc)[:500],
        }
    finally:
        await router.close()


async def main() -> None:
    results = []
    requested = tuple(sys.argv[1:]) or ("anthropic", "gemini")
    for provider in requested:
        if provider not in {"anthropic", "gemini"}:
            results.append({"provider": provider, "ok": False, "error": "Unsupported smoke-test provider"})
            continue
        results.append(await check(provider))
    print(json.dumps({"results": results}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
