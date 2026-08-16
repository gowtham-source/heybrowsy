import re
from urllib.parse import urlparse
from .models import BrowserAction


INJECTION_PATTERNS = [
    re.compile(r"ignore (all |any )?(previous|prior|system) instructions", re.I),
    re.compile(r"reveal|print|upload.{0,30}(system prompt|api key|secret|cookie)", re.I),
    re.compile(r"send|exfiltrate.{0,50}(credentials|cookies|secrets|private)", re.I),
]

SENSITIVE_URL_PARTS = ("bank", "wallet", "checkout", "billing", "admin", "password")
SIDE_EFFECT_WORDS = ("submit", "send", "publish", "post", "delete", "remove", "buy", "purchase", "confirm", "apply")


def detect_prompt_injection(text: str) -> list[str]:
    return [pattern.pattern for pattern in INJECTION_PATTERNS if pattern.search(text)]


def approval_reason(action: BrowserAction, current_url: str, element_name: str = "") -> str | None:
    haystack = f"{action.rationale} {element_name} {action.value or ''}".lower()
    # Prefer the concrete target label. A plan may mention a later side effect
    # (for example, "open Messaging before sending") even when this click is safe.
    click_intent = (element_name or action.rationale).lower()
    if action.type == "click" and any(re.search(rf"\b{re.escape(word)}\b", click_intent) for word in SIDE_EFFECT_WORDS):
        return f"This click may cause an external side effect ({element_name or action.rationale})."
    if action.type == "type" and any(token in haystack for token in ("password", "credit card", "cvv", "secret", "token")):
        return "This action may enter sensitive information."
    host = (urlparse(current_url).hostname or "").lower()
    if any(part in host for part in SENSITIVE_URL_PARTS) and action.type in {"click", "type", "select"}:
        return f"This action modifies a potentially sensitive site ({host})."
    return None
