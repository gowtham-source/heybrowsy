from heybrowsy.config import Settings


def test_auto_provider_order_uses_only_configured_keys():
    settings = Settings(_env_file=None, openai_api_key="openai", gemini_api_key="gemini")
    assert settings.provider_candidates("fast") == ["openai", "gemini"]


def test_mode_provider_override_becomes_primary():
    settings = Settings(
        _env_file=None,
        openai_api_key="openai",
        anthropic_api_key="anthropic",
        accurate_provider="anthropic",
    )
    assert settings.provider_candidates("accurate")[:2] == ["anthropic", "openai"]
    assert settings.model_for("anthropic", "accurate") == "claude-sonnet-5"


def test_explicit_provider_without_key_has_no_route():
    settings = Settings(_env_file=None, openai_api_key="openai", provider="gemini")
    assert settings.provider_candidates("balanced") == []


def test_fallbacks_can_be_disabled():
    settings = Settings(_env_file=None, anthropic_api_key="anthropic", gemini_api_key="gemini", provider="gemini", provider_fallbacks=False)
    assert settings.provider_candidates("fast") == ["gemini"]
