export type SpeedMode = "fast" | "balanced" | "accurate";

export interface ElementRef {
  id: string;
  tag: string;
  role: string;
  name: string;
  type?: string;
  value?: string;
  href?: string;
  disabled: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  visibleText: string;
  selectedText: string;
  elements: ElementRef[];
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  fingerprint: string;
}

export interface BrowserAction {
  id: string;
  type: "click" | "type" | "navigate" | "scroll" | "select" | "read_page" | "finish";
  element_id?: string;
  value?: string;
  url?: string;
  direction?: "up" | "down";
  amount?: number;
  rationale?: string;
}

export interface AgentEvent {
  id?: string;
  type: string;
  task_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}
