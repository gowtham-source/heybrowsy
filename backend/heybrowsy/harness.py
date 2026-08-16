import asyncio
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4
from .config import Settings
from .context import compact_action_result, compact_history, compact_snapshot
from .memory import SessionMemoryStore
from .models import ActionResult, BrowserAction, Event, PageSnapshot, TaskCreate
from .provider import ModelProvider
from .security import approval_reason


TERMINAL = {"complete", "failed", "cancelled"}


@dataclass
class TaskRuntime:
    id: str
    request: TaskCreate
    snapshot: PageSnapshot
    status: str = "queued"
    history: list[dict[str, Any]] = field(default_factory=list)
    subscribers: set[asyncio.Queue[Event]] = field(default_factory=set)
    action_waiters: dict[str, asyncio.Future[ActionResult]] = field(default_factory=dict)
    approval_waiters: dict[str, asyncio.Future[bool]] = field(default_factory=dict)
    replay: list[Event] = field(default_factory=list)
    cancelled: bool = False
    memory_recorded: bool = False

    async def emit(self, event_type: str, **data: Any) -> None:
        event = Event(type=event_type, task_id=self.id, data=data)
        self.replay.append(event)
        self.replay = self.replay[-100:]
        for queue in tuple(self.subscribers):
            await queue.put(event)


class AgentHarness:
    def __init__(self, provider: ModelProvider, settings: Settings):
        self.provider = provider
        self.settings = settings
        self.tasks: dict[str, TaskRuntime] = {}
        self.memory = SessionMemoryStore(settings.memory_path, settings.memory_recent_tasks)

    def create(self, request: TaskCreate) -> TaskRuntime:
        task_id = uuid4().hex
        runtime = TaskRuntime(id=task_id, request=request, snapshot=request.initial_snapshot)
        self.tasks[task_id] = runtime
        asyncio.create_task(self.run(runtime))
        return runtime

    async def run(self, task: TaskRuntime) -> None:
        try:
            task.status = "running"
            await task.emit("status", status="running", message=f"Starting in {task.request.mode.value} mode")
            for step in range(self.settings.max_steps):
                if task.cancelled:
                    await self._finalize(task, "cancelled"); return
                context = compact_snapshot(task.snapshot, task.request.goal, max_text=4500 if task.request.mode.value == "fast" else 7000)
                memory = self.memory.context(task.request.session_id)
                history = compact_history(task.history, memory, self.settings.history_recent_steps)
                decision = await self.provider.decide(goal=task.request.goal, mode=task.request.mode, context=context, history=history)
                await task.emit("thought", message=decision.analysis, confidence=decision.confidence, step=step + 1, provider=decision.provider, model=decision.model)
                action = decision.action
                action.id = action.id or uuid4().hex
                if action.type == "finish":
                    answer = decision.answer or "Task complete"
                    await self._finalize(task, "complete", answer, steps=len(task.history), confidence=decision.confidence)
                    return
                element = next((item for item in task.snapshot.elements if item.id == action.element_id), None)
                element_description = f"{element.name} {element.type or ''}" if element else ""
                reason = approval_reason(action, task.snapshot.url, element_description)
                if reason:
                    approved = await self._request_approval(task, action, reason)
                    if not approved:
                        task.history.append({"action": action.model_dump(), "result": {"ok": False, "error": "User rejected action"}})
                        continue
                result = await self._execute(task, action)
                task.history.append({"action": action.model_dump(exclude_none=True), "result": compact_action_result(result)})
                if result.snapshot:
                    old_fingerprint = task.snapshot.fingerprint
                    task.snapshot = result.snapshot
                    changed = old_fingerprint != result.snapshot.fingerprint
                else:
                    changed = bool(result.navigated)
                await task.emit("verification", action_id=action.id, ok=result.ok, state_changed=changed, error=result.error)
            raise RuntimeError(f"Stopped after {self.settings.max_steps} steps without a verified finish")
        except asyncio.CancelledError:
            await self._finalize(task, "cancelled")
        except Exception as exc:
            await self._finalize(task, "failed", str(exc), error=str(exc))

    async def _finalize(self, task: TaskRuntime, status: str, answer: str | None = None, **event_data: Any) -> None:
        task.status = status
        if not task.memory_recorded:
            try:
                self.memory.record_task(
                    task.request.session_id,
                    goal=task.request.goal,
                    status=status,
                    answer=answer,
                    actions=task.history,
                    url=task.snapshot.url,
                    title=task.snapshot.title,
                )
                task.memory_recorded = True
            except OSError:
                pass
        if status == "complete":
            await task.emit("complete", answer=answer or "Task complete", **event_data)
        elif status == "failed":
            await task.emit("failed", **event_data)
        else:
            await task.emit("cancelled")

    async def _execute(self, task: TaskRuntime, action: BrowserAction) -> ActionResult:
        loop = asyncio.get_running_loop()
        waiter = loop.create_future()
        task.action_waiters[action.id] = waiter
        task.status = "waiting_for_browser"
        await task.emit("action", action_id=action.id, action=action.model_dump(exclude_none=True))
        try:
            result = await asyncio.wait_for(waiter, self.settings.action_timeout_seconds)
            task.status = "running"
            return result
        except TimeoutError as exc:
            raise RuntimeError(f"Browser action '{action.type}' timed out after {self.settings.action_timeout_seconds:g}s") from exc
        finally:
            task.action_waiters.pop(action.id, None)

    async def _request_approval(self, task: TaskRuntime, action: BrowserAction, reason: str) -> bool:
        loop = asyncio.get_running_loop()
        waiter = loop.create_future()
        task.approval_waiters[action.id] = waiter
        task.status = "waiting_for_approval"
        await task.emit("approval_required", action_id=action.id, action=action.model_dump(exclude_none=True), reason=reason)
        try:
            approved = await asyncio.wait_for(waiter, self.settings.approval_timeout_seconds)
            task.status = "running"
            return approved
        except TimeoutError as exc:
            raise RuntimeError(f"Approval timed out after {self.settings.approval_timeout_seconds:g}s") from exc
        finally:
            task.approval_waiters.pop(action.id, None)

    def submit_result(self, task_id: str, action_id: str, result: ActionResult) -> None:
        waiter = self.tasks[task_id].action_waiters.get(action_id)
        if not waiter or waiter.done(): raise KeyError("Action is not awaiting a result")
        waiter.set_result(result)

    def submit_approval(self, task_id: str, action_id: str, approved: bool) -> None:
        waiter = self.tasks[task_id].approval_waiters.get(action_id)
        if not waiter or waiter.done(): raise KeyError("Action is not awaiting approval")
        waiter.set_result(approved)
