import React, { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeyBrowsyApi } from "./api";
import type { AgentEvent, BrowserAction, PageSnapshot, SpeedMode } from "./types";
import "./styles.css";

const API_URL = "http://127.0.0.1:8765";
type FeedItem = { id: string; kind: "user" | "agent" | "tool" | "error"; text: string };
type Approval = { actionId: string; action: BrowserAction; reason: string };
type SavedSession = { id: string; preview: string; updatedAt: number };

class PanelErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("heybrowsy panel error", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="fatal">
      <span className="spark">✦</span><h1>Panel needs a refresh</h1>
      <p>{this.state.error.message || "An unexpected rendering error occurred."}</p>
      <button onClick={() => location.reload()}>Reload heybrowsy</button>
    </div>;
  }
}

function App() {
  const api = useMemo(() => new HeyBrowsyApi(API_URL), []);
  const anchorTabId = useMemo(() => {
    const value = Number(new URLSearchParams(location.search).get("tabId"));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }, []);
  const sessionSlot = useMemo(() => `heybrowsy.current-session.${anchorTabId ?? "active"}`, [anchorTabId]);
  const sessionIndexKey = "heybrowsy.sessions";
  const [sessionId, setSessionId] = useState(() => {
    const previous = localStorage.getItem(sessionSlot);
    return previous || `browser-tab-${anchorTabId ?? "active"}`;
  });
  const activeTaskKey = useMemo(() => `heybrowsy.active.${sessionId}`, [sessionId]);
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<SpeedMode>("balanced");
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [visibleFeedCount, setVisibleFeedCount] = useState(80);
  const [approval, setApproval] = useState<Approval>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const feedRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const eventQueueRef = useRef(Promise.resolve());
  const processedEventsRef = useRef(new Set<string>());
  const queuedEventsRef = useRef(new Set<string>());
  const resumeAttemptedRef = useRef(false);

  useEffect(() => { api.health().then(() => setConnected(true)).catch(() => setConnected(false)); }, [api]);
  useEffect(() => {
    const key = `heybrowsy.feed.${sessionId}`;
    setHistoryLoaded(false);
    setFeed([]);
    void chrome.storage.local.get(key).then((stored) => {
      const restored = stored[key];
      if (Array.isArray(restored)) setFeed(restored.slice(-400) as FeedItem[]);
      setHistoryLoaded(true);
    });
  }, [sessionId]);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    void chrome.storage.session.get(activeTaskKey).then(async (stored) => {
      const active = stored[activeTaskKey] as { taskId?: string; lastEventId?: string } | undefined;
      if (!active?.taskId) return;
      setTaskId(active.taskId); setRunning(true);
      processedEventsRef.current.clear(); queuedEventsRef.current.clear();
      streamRef.current?.close();
      streamRef.current = api.stream(active.taskId, enqueueEvent, active.lastEventId);
    }).catch((error) => append("error", `Could not resume task: ${String(error)}`));
  }, [activeTaskKey, api]);
  useEffect(() => {
    if (!historyLoaded) return;
    const key = `heybrowsy.feed.${sessionId}`;
    const timeout = setTimeout(() => {
      const savedFeed = feed.slice(-400);
      void chrome.storage.local.set({ [key]: savedFeed });
      if (savedFeed.length) {
        void chrome.storage.local.get(sessionIndexKey).then((stored) => {
          const existing = Array.isArray(stored[sessionIndexKey]) ? stored[sessionIndexKey] as SavedSession[] : [];
          const latestUserMessage = [...savedFeed].reverse().find((item) => item.kind === "user")?.text || "Untitled session";
          const entry: SavedSession = { id: sessionId, preview: latestUserMessage.slice(0, 90), updatedAt: Date.now() };
          const next = [entry, ...existing.filter((item) => item.id !== sessionId)].slice(0, 30);
          void chrome.storage.local.set({ [sessionIndexKey]: next });
        });
      }
    }, 120);
    return () => clearTimeout(timeout);
  }, [feed, historyLoaded, sessionId, sessionIndexKey]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(132, Math.max(38, textarea.scrollHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > 132 ? "auto" : "hidden";
  }, [goal]);
  useEffect(() => {
    const feedElement = feedRef.current;
    if (feedElement) feedElement.scrollTo({ top: feedElement.scrollHeight, behavior: "smooth" });
  }, [feed, approval, running]);
  useEffect(() => () => streamRef.current?.close(), []);

  const append = (kind: FeedItem["kind"], text: string) =>
    setFeed((items) => [...items, { id: crypto.randomUUID(), kind, text }]);

  async function onEvent(event: AgentEvent) {
    const data = event.data;
    if (event.type === "status") append("agent", String(data.message || data.status));
    if (event.type === "thought") append("agent", String(data.message));
    if (event.type === "approval_required") {
      setApproval({ actionId: String(data.action_id), action: data.action as unknown as BrowserAction, reason: String(data.reason) });
      append("agent", `Approval needed: ${String(data.reason)}`);
    }
    if (event.type === "action") {
      const action = data.action as unknown as BrowserAction;
      append("tool", `${action.type}${action.rationale ? ` — ${action.rationale}` : ""}`);
      let result: Record<string, unknown>;
      try {
        result = await chrome.runtime.sendMessage({ type: "HB_BROWSER_ACTION", action });
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      await api.actionResult(event.task_id, action.id, result);
    }
    if (event.type === "connection_error") {
      const task = await api.task(event.task_id).catch(() => undefined);
      if (task && ["complete", "failed", "cancelled"].includes(task.status)) setRunning(false);
      return;
    }
    if (event.type === "complete") { append("agent", String(data.answer || "Task complete")); setRunning(false); setApproval(undefined); }
    if (event.type === "failed") { append("error", String(data.error || "Task failed")); setRunning(false); setApproval(undefined); }
    if (event.type === "cancelled") { append("agent", "Task stopped"); setRunning(false); setApproval(undefined); }
    if (["complete", "failed", "cancelled"].includes(event.type)) {
      streamRef.current?.close();
      await chrome.storage.session.remove(activeTaskKey);
      await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
    }
  }

  function enqueueEvent(event: AgentEvent) {
    if (event.id && processedEventsRef.current.has(event.id)) return;
    if (event.id && queuedEventsRef.current.has(event.id)) return;
    if (event.id) queuedEventsRef.current.add(event.id);
    eventQueueRef.current = eventQueueRef.current
      .then(() => onEvent(event))
      .then(async () => {
        if (event.id) {
          queuedEventsRef.current.delete(event.id);
          processedEventsRef.current.add(event.id);
          if (["complete", "failed", "cancelled"].includes(event.type)) await chrome.storage.session.remove(activeTaskKey);
          else await chrome.storage.session.set({ [activeTaskKey]: { taskId: event.task_id, lastEventId: event.id } });
        }
      })
      .catch((error) => {
        if (event.id) queuedEventsRef.current.delete(event.id);
        append("error", `Event handling failed: ${String(error)}`); setRunning(false);
      });
  }

  async function run() {
    if (!goal.trim() || running) return;
    setRunning(true); setApproval(undefined); append("user", goal.trim());
    try {
      const permission = await chrome.permissions.request({ origins: ["<all_urls>"] });
      if (!permission) throw new Error("Page access is required to run browser tasks");
      const page = await chrome.runtime.sendMessage({ type: "HB_ATTACH_BROWSER", tabId: anchorTabId }) as { ok: boolean; snapshot?: PageSnapshot; error?: string };
      if (!page.ok || !page.snapshot) throw new Error(page.error || "Could not read the active page");
      const task = await api.createTask(goal.trim(), mode, page.snapshot, sessionId);
      setTaskId(task.id); setGoal("");
      processedEventsRef.current.clear(); queuedEventsRef.current.clear();
      await chrome.storage.session.set({ [activeTaskKey]: { taskId: task.id } });
      streamRef.current?.close();
      streamRef.current = api.stream(task.id, enqueueEvent);
    } catch (error) {
      append("error", String(error)); setRunning(false);
      await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
    }
  }

  async function decide(approved: boolean) {
    if (!approval || !taskId) return;
    await api.approval(taskId, approval.actionId, approved);
    append("tool", approved ? "Action approved" : "Action rejected"); setApproval(undefined);
  }


  async function stop() {
    if (!taskId) return;
    try { await api.cancel(taskId); }
    catch (error) { append("error", `Could not stop task: ${String(error)}`); }
    streamRef.current?.close();
    setRunning(false); setApproval(undefined);
    await chrome.storage.session.remove(activeTaskKey);
    await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
  }

  async function newSession() {
    if (running) return;
    const previousActiveTaskKey = activeTaskKey;
    const nextSessionId = `browser-tab-${anchorTabId ?? "active"}-${crypto.randomUUID()}`;
    localStorage.setItem(sessionSlot, nextSessionId);
    streamRef.current?.close();
    processedEventsRef.current.clear();
    queuedEventsRef.current.clear();
    resumeAttemptedRef.current = false;
    setGoal("");
    setFeed([]);
    setTaskId(undefined);
    setApproval(undefined);
    setHistoryOpen(false);
    setVisibleFeedCount(80);
    setSessionId(nextSessionId);
    await chrome.storage.session.remove(previousActiveTaskKey);
    await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
  }

  async function openHistory() {
    if (running) return;
    if (historyOpen) { setHistoryOpen(false); return; }
    const stored = await chrome.storage.local.get(null);
    const indexed = Array.isArray(stored[sessionIndexKey]) ? stored[sessionIndexKey] as SavedSession[] : [];
    const byId = new Map(indexed.map((item) => [item.id, item]));
    const feedKeyPrefix = "heybrowsy.feed.";
    Object.entries(stored).forEach(([key, value]) => {
      if (!key.startsWith(feedKeyPrefix)) return;
      const id = key.slice(feedKeyPrefix.length);
      if (!id.startsWith("browser-tab-") || !Array.isArray(value) || value.length === 0) return;
      const items = value as FeedItem[];
      const latestUserMessage = [...items].reverse().find((item) => item.kind === "user")?.text || "Untitled session";
      const indexedItem = byId.get(id);
      byId.set(id, { id, preview: indexedItem?.preview || latestUserMessage.slice(0, 90), updatedAt: indexedItem?.updatedAt || 0 });
    });
    setSavedSessions([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt));
    setHistoryOpen(true);
  }

  async function loadSession(nextSessionId: string) {
    if (running || nextSessionId === sessionId) { setHistoryOpen(false); return; }
    streamRef.current?.close();
    processedEventsRef.current.clear();
    queuedEventsRef.current.clear();
    resumeAttemptedRef.current = false;
    setHistoryLoaded(false);
    setFeed([]);
    setGoal("");
    setTaskId(undefined);
    setApproval(undefined);
    setVisibleFeedCount(80);
    setHistoryOpen(false);
    localStorage.setItem(sessionSlot, nextSessionId);
    setSessionId(nextSessionId);
    await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
  }

  return <main className={feed.length || running ? "active" : ""}>
    <header>
      <div className="brand"><span className="spark">✦</span><span>heybrowsy</span><span className="beta">alpha</span></div>
      <div className="header-actions">
        <button className={`history-button ${historyOpen ? "selected" : ""}`} type="button" disabled={running} onClick={() => void openHistory()} aria-label="Conversation history" title={running ? "Stop the current task before loading history" : "Conversation history"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/></svg>
        </button>
        <button className="new-session" type="button" disabled={running} onClick={() => void newSession()} aria-label="Start a new session" title={running ? "Stop the current task before starting a new session" : "Start a new session"}><span>＋</span> New</button>
        <div className={`status ${connected ? "online" : ""}`}><i />{connected ? "ready" : "offline"}</div>
      </div>
    </header>
    {historyOpen && <section className="history-panel" aria-label="Conversation history">
      <div className="history-heading"><div><p className="eyebrow">CONVERSATIONS</p><strong>Continue a session</strong></div><button onClick={() => setHistoryOpen(false)} aria-label="Close history">×</button></div>
      <div className="history-list">
        {savedSessions.length === 0 && <p className="history-empty">No previous conversations yet.</p>}
        {savedSessions.map((item) => <button key={item.id} className={item.id === sessionId ? "current" : ""} onClick={() => void loadSession(item.id)}>
          <span>{item.preview}</span><small>{item.id === sessionId ? "Current session" : item.updatedAt ? new Date(item.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Saved session"}</small>
        </button>)}
      </div>
    </section>}
    <section className="hero">
      <p className="eyebrow">BROWSER WORK AGENT</p>
      <h1>Tell the web<br/><em>what to do.</em></h1>
      <p>Research, navigate, extract, and finish work with visible steps and your approval.</p>
    </section>
    <section className="feed" ref={feedRef}>
      {feed.length === 0 && <div className="suggestions">
        {["Summarize this page with key evidence", "Find the pricing and compare plans", "Fill this form, but ask before submitting"].map((text) =>
          <button key={text} onClick={() => setGoal(text)}>{text}<span>↗</span></button>)}
      </div>}
      {feed.length > visibleFeedCount && <button className="show-earlier" onClick={() => setVisibleFeedCount((count) => count + 80)}>Show earlier activity</button>}
      {feed.slice(-visibleFeedCount).map((item) => <article key={item.id} className={item.kind}><span>{item.kind === "user" ? "YOU" : item.kind === "tool" ? "ACTION" : "BROWSY"}</span><p>{item.text}</p></article>)}
      {running && <div className="thinking"><b/><b/><b/></div>}
    </section>
    {approval && <aside className="approval">
      <p className="eyebrow">YOUR APPROVAL</p><strong>{approval.action.type}</strong><p>{approval.reason}</p>
      <div><button className="reject" onClick={() => decide(false)}>Reject</button><button onClick={() => decide(true)}>Approve once</button></div>
    </aside>}
    <footer>
      <div className="mode-picker">
        {(["fast", "balanced", "accurate"] as SpeedMode[]).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>)}
      </div>
      <div className="composer">
        <textarea ref={textareaRef} rows={1} aria-label="Task" placeholder="Ask heybrowsy to do something…" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(); }}} />
        {running ? <button className="send stop" aria-label="Stop task" onClick={stop}>■</button> : <button className="send" aria-label="Run task" onClick={run}>↑</button>}
      </div>
      <small>heybrowsy can make mistakes. Review high-impact actions.</small>
    </footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><PanelErrorBoundary><App /></PanelErrorBoundary></React.StrictMode>);
