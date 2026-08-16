from functools import lru_cache
from typing import Literal
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="HEYBROWSY_", extra="ignore", populate_by_name=True)
    host: str = "127.0.0.1"
    port: int = 8765
    provider: Literal["auto", "openai", "anthropic", "gemini"] = "auto"
    fast_provider: Literal["auto", "openai", "anthropic", "gemini"] = "auto"
    balanced_provider: Literal["auto", "openai", "anthropic", "gemini"] = "auto"
    accurate_provider: Literal["auto", "openai", "anthropic", "gemini"] = "auto"
    provider_fallback_order: str = "openai,anthropic,gemini"
    provider_fallbacks: bool = True
    openai_api_key: str | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY", "HEYBROWSY_OPENAI_API_KEY"))
    openai_base_url: str = "https://api.openai.com/v1"
    openai_fast_model: str = Field(default="gpt-5.6-luna", validation_alias=AliasChoices("HEYBROWSY_OPENAI_FAST_MODEL", "HEYBROWSY_FAST_MODEL"))
    openai_balanced_model: str = Field(default="gpt-5.6-terra", validation_alias=AliasChoices("HEYBROWSY_OPENAI_BALANCED_MODEL", "HEYBROWSY_BALANCED_MODEL"))
    openai_accurate_model: str = Field(default="gpt-5.6-sol", validation_alias=AliasChoices("HEYBROWSY_OPENAI_ACCURATE_MODEL", "HEYBROWSY_ACCURATE_MODEL"))
    anthropic_api_key: str | None = Field(default=None, validation_alias=AliasChoices("ANTHROPIC_API_KEY", "HEYBROWSY_ANTHROPIC_API_KEY"))
    anthropic_base_url: str | None = None
    anthropic_fast_model: str = "claude-haiku-4-5-20251001"
    anthropic_balanced_model: str = "claude-sonnet-5"
    anthropic_accurate_model: str = "claude-sonnet-5"
    gemini_api_key: str | None = Field(default=None, validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY", "HEYBROWSY_GEMINI_API_KEY"))
    gemini_fast_model: str = "gemini-3.5-flash-lite"
    gemini_balanced_model: str = "gemini-3.6-flash"
    gemini_accurate_model: str = "gemini-3.6-flash"
    max_steps: int = 24
    action_timeout_seconds: float = 45.0
    approval_timeout_seconds: float = 180.0
    memory_path: str = "data/session_memory.json"
    memory_recent_tasks: int = 6
    history_recent_steps: int = 6
    cors_origins: str = "chrome-extension://*,http://localhost:5173"

    def model_for(self, provider: str, mode: str) -> str:
        profile = "fast" if mode == "fast" else "accurate" if mode == "accurate" else "balanced"
        return str(getattr(self, f"{provider}_{profile}_model"))

    def preferred_provider_for(self, mode: str) -> str:
        override = str(getattr(self, f"{mode}_provider", "auto"))
        return override if override != "auto" else self.provider

    def configured_provider_names(self) -> list[str]:
        return [name for name in ("openai", "anthropic", "gemini") if getattr(self, f"{name}_api_key", None)]

    def provider_candidates(self, mode: str) -> list[str]:
        configured = self.configured_provider_names()
        preferred = self.preferred_provider_for(mode)
        if preferred != "auto" and preferred not in configured:
            return []
        order = [name.strip() for name in self.provider_fallback_order.split(",") if name.strip() in configured]
        if preferred != "auto":
            order = [preferred, *order]
        candidates = list(dict.fromkeys(name for name in order if name in configured))
        return candidates if self.provider_fallbacks else candidates[:1]


@lru_cache
def get_settings() -> Settings:
    return Settings()
