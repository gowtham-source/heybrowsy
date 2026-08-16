import json
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any


class SessionMemoryStore:
    """Local structured memory that stores outcomes, never raw page snapshots."""

    def __init__(self, path: str, recent_tasks: int = 6):
        self.path = Path(path)
        self.recent_tasks = recent_tasks
        self._lock = RLock()
        self._sessions: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                self._sessions = payload
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            self._sessions = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._sessions, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    def context(self, session_id: str | None) -> dict[str, Any]:
        if not session_id:
            return {"task_count": 0, "recent_tasks": []}
        with self._lock:
            session = self._sessions.get(session_id, {})
            tasks = list(session.get("tasks", []))
            return {
                "task_count": len(tasks),
                "recent_tasks": tasks[-self.recent_tasks :],
                "last_updated": session.get("updated_at"),
                "note": "Compact local memory from earlier tasks. Re-observe mutable page state before acting.",
            }

    def record_task(self, session_id: str | None, *, goal: str, status: str, answer: str | None,
                    actions: list[dict[str, Any]], url: str, title: str) -> None:
        if not session_id:
            return
        compact_actions = []
        for step in actions[-12:]:
            action = step.get("action", {})
            result = step.get("result", {})
            compact_actions.append({
                "type": action.get("type"),
                "target": action.get("element_id") or action.get("url"),
                "rationale": str(action.get("rationale", ""))[:180],
                "ok": result.get("ok"),
                "error": str(result.get("error", ""))[:180] or None,
            })
        record = {
            "goal": goal[:800],
            "status": status,
            "outcome": (answer or "")[:1200],
            "final_page": {"url": url, "title": title[:240]},
            "actions": compact_actions,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            session = self._sessions.setdefault(session_id, {"tasks": []})
            tasks = session.setdefault("tasks", [])
            tasks.append(record)
            session["tasks"] = tasks[-30:]
            session["updated_at"] = record["completed_at"]
            self._save()
