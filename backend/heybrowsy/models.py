from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4
from pydantic import BaseModel, Field, HttpUrl


class SpeedMode(StrEnum):
    fast = "fast"
    balanced = "balanced"
    accurate = "accurate"


class ElementRect(BaseModel):
    x: int
    y: int
    width: int
    height: int


class ElementRef(BaseModel):
    id: str
    tag: str
    role: str
    name: str = ""
    type: str | None = None
    value: str | None = None
    href: str | None = None
    disabled: bool = False
    rect: ElementRect


class Viewport(BaseModel):
    width: int
    height: int
    scrollX: int
    scrollY: int


class PageSnapshot(BaseModel):
    url: str
    title: str
    visibleText: str = Field(max_length=15_000)
    selectedText: str = Field(default="", max_length=4_000)
    elements: list[ElementRef] = Field(max_length=200)
    viewport: Viewport
    fingerprint: str


class TaskCreate(BaseModel):
    goal: str = Field(min_length=2, max_length=8_000)
    mode: SpeedMode = SpeedMode.balanced
    initial_snapshot: PageSnapshot


class BrowserAction(BaseModel):
    id: str = ""
    type: Literal["click", "type", "navigate", "scroll", "select", "read_page", "finish"]
    element_id: str | None = None
    value: str | None = None
    url: str | None = None
    direction: Literal["up", "down"] | None = None
    amount: int | None = None
    rationale: str = ""
    expected_change: str = ""


class AgentDecision(BaseModel):
    analysis: str = Field(max_length=1200)
    action: BrowserAction
    answer: str | None = None
    confidence: float = Field(ge=0, le=1, default=0.5)
    provider: str | None = None
    model: str | None = None


class ActionResult(BaseModel):
    ok: bool
    error: str | None = None
    navigated: bool | None = None
    snapshot: PageSnapshot | None = None


class ApprovalDecision(BaseModel):
    approved: bool


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    type: str
    task_id: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    data: dict[str, Any] = Field(default_factory=dict)
