import asyncio
from heybrowsy.config import Settings
from heybrowsy.harness import AgentHarness
from heybrowsy.models import ActionResult, ElementRect, ElementRef, PageSnapshot, TaskCreate, Viewport
from heybrowsy.provider import DemoProvider


def page():
    return PageSnapshot(url="https://example.com", title="Example", visibleText="Example page", selectedText="", elements=[ElementRef(id="one", tag="a", role="link", name="More", href="https://example.com/more", disabled=False, rect=ElementRect(x=1, y=2, width=3, height=4))], viewport=Viewport(width=100, height=100, scrollX=0, scrollY=0), fingerprint="a")


async def wait_until(predicate, timeout=1):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.005)


async def test_demo_task_runs_action_observation_completion_loop():
    harness = AgentHarness(DemoProvider(), Settings(max_steps=3))
    task = harness.create(TaskCreate(goal="Summarize the page", initial_snapshot=page()))
    await wait_until(lambda: bool(task.action_waiters))
    action_id = next(iter(task.action_waiters))
    harness.submit_result(task.id, action_id, ActionResult(ok=True, snapshot=page()))
    await wait_until(lambda: task.status == "complete")
    assert [event.type for event in task.replay][-1] == "complete"
    assert len(task.history) == 1

