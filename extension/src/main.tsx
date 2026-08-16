import React, { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeyBrowsyApi } from "./api";
import type { AgentEvent, BrowserAction, PageSnapshot, SpeedMode } from "./types";
import "./styles.css";

const API_URL = "http://127.0.0.1:8765";
type FeedItem = { id: string; kind: "user" | "agent" | "tool" | "error"; text: string };
type Approval = { actionId: string; action: BrowserAction; reason: string };

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
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<SpeedMode>("balanced");
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [approval, setApproval] = useState<Approval>();
  const feedRef = useRef<HTMLElement>(null);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const eventQueueRef = useRef(Promise.resolve());
  const processedEventsRef = useRef(new Set<string>());

  useEffect(() => { api.health().then(() => setConnected(true)).catch(() => setConnected(false)); }, [api]);
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
      await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
    }
  }

  function enqueueEvent(event: AgentEvent) {
    if (event.id && processedEventsRef.current.has(event.id)) return;
    if (event.id) processedEventsRef.current.add(event.id);
    eventQueueRef.current = eventQueueRef.current
      .then(() => onEvent(event))
      .catch((error) => { append("error", `Event handling failed: ${String(error)}`); setRunning(false); });
  }

  async function run() {
    if (!goal.trim() || running) return;
    setRunning(true); setApproval(undefined); append("user", goal.trim());
    try {
      const permission = await chrome.permissions.request({ origins: ["<all_urls>"] });
      if (!permission) throw new Error("Page access is required to run browser tasks");
      const page = await chrome.runtime.sendMessage({ type: "HB_ATTACH_BROWSER", tabId: anchorTabId }) as { ok: boolean; snapshot?: PageSnapshot; error?: string };
      if (!page.ok || !page.snapshot) throw new Error(page.error || "Could not read the active page");
      const task = await api.createTask(goal.trim(), mode, page.snapshot);
      setTaskId(task.id); setGoal("");
      processedEventsRef.current.clear();
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
    await chrome.runtime.sendMessage({ type: "HB_RELEASE_BROWSER" }).catch(() => undefined);
  }

  return <main className={feed.length || running ? "active" : ""}>
    <header>
      <div className="brand"><span className="spark">✦</span><span>heybrowsy</span><span className="beta">alpha</span></div>
      <div className={`status ${connected ? "online" : ""}`}><i />{connected ? "ready" : "offline"}</div>
    </header>
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
      {feed.map((item) => <article key={item.id} className={item.kind}><span>{item.kind === "user" ? "YOU" : item.kind === "tool" ? "ACTION" : "BROWSY"}</span><p>{item.text}</p></article>)}
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
        <textarea aria-label="Task" placeholder="Ask heybrowsy to do something…" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(); }}} />
        {running ? <button className="send stop" aria-label="Stop task" onClick={stop}>■</button> : <button className="send" aria-label="Run task" onClick={run}>↑</button>}
      </div>
      <small>heybrowsy can make mistakes. Review high-impact actions.</small>
    </footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><PanelErrorBoundary><App /></PanelErrorBoundary></React.StrictMode>);
