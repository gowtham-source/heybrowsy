import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .config import get_settings
from .harness import AgentHarness
from .models import ActionResult, ApprovalDecision, Event, TaskCreate
from .provider import create_provider


settings = get_settings()
harness = AgentHarness(create_provider(settings), settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        await harness.provider.close()


app = FastAPI(title="heybrowsy API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_task(task_id: str):
    task = harness.tasks.get(task_id)
    if not task: raise HTTPException(404, "Task not found")
    return task


@app.get("/health")
async def health():
    routing = harness.provider.describe() if hasattr(harness.provider, "describe") else {}
    return {"status": "ok", "service": "heybrowsy", "provider": type(harness.provider).__name__, "routing": routing}


@app.post("/v1/tasks", status_code=202)
async def create_task(request: TaskCreate):
    task = harness.create(request)
    return {"id": task.id, "status": task.status, "mode": request.mode}


@app.get("/v1/tasks/{task_id}")
async def task_status(task_id: str):
    task = get_task(task_id)
    return {"id": task.id, "status": task.status, "steps": len(task.history)}


@app.get("/v1/tasks/{task_id}/stream")
async def task_stream(task_id: str):
    task = get_task(task_id)
    queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=100)
    task.subscribers.add(queue)

    async def events():
        try:
            replay = list(task.replay)
            seen = {event.id for event in replay}
            for event in replay:
                yield f"data: {event.model_dump_json()}\n\n"
            if task.status in {"complete", "failed", "cancelled"}: return
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    if event.id in seen:
                        continue
                    seen.add(event.id)
                    yield f"data: {event.model_dump_json()}\n\n"
                    if event.type in {"complete", "failed", "cancelled"}: return
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            task.subscribers.discard(queue)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/v1/tasks/{task_id}/actions/{action_id}/result", status_code=202)
async def action_result(task_id: str, action_id: str, result: ActionResult):
    get_task(task_id)
    try: harness.submit_result(task_id, action_id, result)
    except KeyError as exc: raise HTTPException(409, str(exc)) from exc
    return {"accepted": True}


@app.post("/v1/tasks/{task_id}/approvals/{action_id}", status_code=202)
async def approval(task_id: str, action_id: str, decision: ApprovalDecision):
    get_task(task_id)
    try: harness.submit_approval(task_id, action_id, decision.approved)
    except KeyError as exc: raise HTTPException(409, str(exc)) from exc
    return {"accepted": True}


@app.post("/v1/tasks/{task_id}/cancel", status_code=202)
async def cancel(task_id: str):
    task = get_task(task_id); task.cancelled = True
    for waiter in [*task.action_waiters.values(), *task.approval_waiters.values()]:
        if not waiter.done(): waiter.cancel()
    return {"accepted": True}
