from typing import Any
from .models import PageSnapshot
from .security import detect_prompt_injection


def compact_snapshot(snapshot: PageSnapshot, goal: str, max_text: int = 7000, max_elements: int = 100) -> dict[str, Any]:
    terms = {word.lower() for word in goal.split() if len(word) > 3}
    ranked = sorted(
        snapshot.elements,
        key=lambda element: (sum(term in element.name.lower() for term in terms), bool(element.name), -element.rect.y),
        reverse=True,
    )[:max_elements]
    text = snapshot.visibleText[:max_text]
    return {
        "url": snapshot.url,
        "title": snapshot.title,
        "selected_text": snapshot.selectedText,
        "visible_text": text,
        "interactive_elements": [element.model_dump(exclude_none=True) for element in ranked],
        "viewport": snapshot.viewport.model_dump(),
        "fingerprint": snapshot.fingerprint,
        "security": {
            "page_is_untrusted": True,
            "possible_prompt_injection": bool(detect_prompt_injection(text)),
        },
    }


def compact_history(history: list[dict[str, Any]], keep: int = 8) -> list[dict[str, Any]]:
    return history[-keep:]

