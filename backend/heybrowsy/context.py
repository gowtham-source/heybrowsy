from typing import Any
from .models import ActionResult, PageSnapshot
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


def compact_action_result(result: ActionResult) -> dict[str, Any]:
    compact: dict[str, Any] = {"ok": result.ok}
    if result.error:
        compact["error"] = result.error[:500]
    if result.navigated:
        compact["navigated"] = True
    if result.snapshot:
        compact["page"] = {
            "url": result.snapshot.url,
            "title": result.snapshot.title[:240],
            "fingerprint": result.snapshot.fingerprint,
            "interactive_count": len(result.snapshot.elements),
        }
    return compact


def compact_history(history: list[dict[str, Any]], session_memory: dict[str, Any] | None = None,
                    keep: int = 6) -> dict[str, Any]:
    older = history[:-keep] if len(history) > keep else []
    compacted = [
        {
            "step": index + 1,
            "action": item.get("action", {}).get("type"),
            "rationale": str(item.get("action", {}).get("rationale", ""))[:160],
            "ok": item.get("result", {}).get("ok"),
            "page": item.get("result", {}).get("page", {}).get("url"),
        }
        for index, item in enumerate(older)
    ]
    return {
        "session_memory": session_memory or {"task_count": 0, "recent_tasks": []},
        "compacted_earlier_steps": compacted,
        "recent_steps": history[-keep:],
    }
