import re
from typing import Any

from .models import BrowserAction, SpeedMode


_COMPLEX_OPERATIONS = (
    "analyse", "analyze", "assess", "compare", "evaluate", "find", "research",
    "search", "rank", "personalise", "personalize", "write", "generate",
    "message", "send", "comment", "apply", "connect",
)


def goal_complexity(goal: str) -> int:
    """Cheap, deterministic routing signal; no model call or user data leaves the process."""
    normalized = re.sub(r"\s+", " ", goal.lower())
    operations = sum(bool(re.search(rf"\b{re.escape(word)}\w*\b", normalized)) for word in _COMPLEX_OPERATIONS)
    sequencing = len(re.findall(r"\b(?:and then|then|after|before|each|multiple|best|top)\b|[,;]", normalized))
    external_write = 2 if re.search(r"\b(?:send|post|comment|apply|connect|submit|purchase|delete)\w*\b", normalized) else 0
    return operations + min(sequencing, 3) + external_write


def planning_mode(requested: SpeedMode, goal: str) -> SpeedMode:
    # Small execution models are excellent for short, bounded work. Complex goals
    # need a stronger planner even when the user prefers fast UI latency.
    if requested == SpeedMode.fast and goal_complexity(goal) >= 5:
        return SpeedMode.balanced
    return requested


def action_signature(action: BrowserAction) -> tuple[Any, ...]:
    """Ignore generated action IDs and prose so semantic duplicates compare equal."""
    return (
        action.type,
        action.element_id,
        action.value,
        action.url,
        action.direction,
        action.amount,
    )
