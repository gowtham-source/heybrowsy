from heybrowsy.context import compact_action_result, compact_history
from heybrowsy.memory import SessionMemoryStore
from heybrowsy.models import ActionResult, PageSnapshot, Viewport


def test_compaction_keeps_recent_steps_and_summarizes_older_steps():
    history = [
        {"action": {"type": "click", "rationale": f"step {index}"}, "result": {"ok": True, "page": {"url": f"https://example.com/{index}"}}}
        for index in range(10)
    ]
    compacted = compact_history(history, {"task_count": 2}, keep=3)
    assert len(compacted["recent_steps"]) == 3
    assert len(compacted["compacted_earlier_steps"]) == 7
    assert compacted["session_memory"]["task_count"] == 2


def test_action_result_does_not_retain_raw_snapshot():
    page = PageSnapshot(url="https://example.com/", title="Example", visibleText="large content", elements=[],
                        viewport=Viewport(width=100, height=100, scrollX=0, scrollY=0), fingerprint="one")
    compacted = compact_action_result(ActionResult(ok=True, snapshot=page))
    assert "snapshot" not in compacted
    assert compacted["page"]["url"] == "https://example.com/"


def test_session_memory_persists_compact_task_outcomes(tmp_path):
    path = tmp_path / "memory.json"
    store = SessionMemoryStore(str(path))
    store.record_task("session-1", goal="Find pricing", status="complete", answer="Found Pro",
                      actions=[], url="https://example.com/pricing", title="Pricing")
    restored = SessionMemoryStore(str(path)).context("session-1")
    assert restored["task_count"] == 1
    assert restored["recent_tasks"][0]["outcome"] == "Found Pro"
