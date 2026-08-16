import type { AgentEvent, PageSnapshot, SpeedMode } from "./types";

export class HeyBrowsyApi {
  constructor(private readonly baseUrl: string) {}

  async health() {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) throw new Error("Backend unavailable");
    return response.json();
  }

  async createTask(goal: string, mode: SpeedMode, snapshot: PageSnapshot, sessionId?: string) {
    const response = await fetch(`${this.baseUrl}/v1/tasks`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, mode, session_id: sessionId, initial_snapshot: snapshot }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ id: string }>;
  }

  stream(taskId: string, onEvent: (event: AgentEvent) => void, afterEventId?: string) {
    const query = afterEventId ? `?after=${encodeURIComponent(afterEventId)}` : "";
    const source = new EventSource(`${this.baseUrl}/v1/tasks/${taskId}/stream${query}`);
    source.onmessage = (message) => onEvent(JSON.parse(message.data));
    source.onerror = () => onEvent({ type: "connection_error", task_id: taskId, timestamp: new Date().toISOString(), data: {} });
    return source;
  }

  async task(taskId: string) {
    const response = await fetch(`${this.baseUrl}/v1/tasks/${taskId}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ id: string; status: string; steps: number }>;
  }

  async actionResult(taskId: string, actionId: string, result: Record<string, unknown>) {
    const response = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/actions/${actionId}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  async approval(taskId: string, actionId: string, approved: boolean) {
    const response = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/approvals/${actionId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  async cancel(taskId: string) {
    const response = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/cancel`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
  }
}
