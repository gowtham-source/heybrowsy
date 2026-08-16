# heybrowsy architecture

heybrowsy uses a small, deliberate permission surface. Page access is optional and requested only when a task begins. The initial build deliberately omits debugger and native-messaging access.

## Runtime flow

```text
Side panel
  │ task + mode
  ▼
Service worker ── injects content bridge on demand
  │
  ├── semantic PageSnapshot ──────────────┐
  │                                       ▼
  │                              FastAPI task gateway
  │                                       │
  │                              compact + isolate context
  │                                       │
  │                              model-routed next action
  │                                       │ SSE
  ◄──────────────────────── browser action┘
  │
  ├── execute in active tab
  ├── observe new snapshot
  └── POST result → verify → next action / finish
```

## Harness engineering

Each task is a small state machine, not an open-ended chat loop:

1. Build a goal-ranked, bounded context pack.
2. Ask for one strict-schema decision.
3. Validate the target against current element IDs.
4. Apply the risk policy and pause when approval is required.
5. Execute via the extension.
6. Compare page fingerprints and record the result.
7. Continue with compact working memory: six detailed steps plus high-signal summaries of older steps.
8. Stop on verified completion, cancellation, timeout, or the maximum step budget.

The event stream separates reasoning/status, approval requests, actions, verification, and completion. Action and approval waiters are keyed by unpredictable IDs, have explicit timeouts, and cannot be submitted twice.

## Model-provider architecture

```text
Task speed mode
      │
      ▼
Provider Router ── per-mode override
      │
      ├── OpenAI Responses API
      ├── Anthropic async Messages SDK
      └── Google GenAI async Interactions SDK
              │
              ▼
      strict AgentDecision schema
              │
              ▼
        Pydantic validation
```

Providers share the same compact task context and response contract, but each adapter uses its native architecture:

- OpenAI: Responses API JSON Schema format with mode-specific reasoning effort.
- Anthropic: top-level system prompt plus `output_config.format` structured output.
- Gemini: Interactions API with a system instruction, structured `response_format`, and `minimal`, `medium`, or `high` thinking by speed mode.

The defaults were selected from the current [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Claude structured-output guide](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini model guide](https://ai.google.dev/gemini-api/docs/models), and [Gemini Interactions structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output).

Routing is configuration-driven. Each speed mode can select a different provider, and an ordered fallback chain handles transient provider failure or invalid output. Errors are aggregated only if every candidate fails. Provider/model metadata is attached to task thought events for observability; credentials are never included.

## Context engineering

The webpage never enters the instruction hierarchy. It is represented as untrusted structured data containing:

- URL and title;
- a bounded visible-text excerpt;
- selected text;
- up to 180 interactive elements, prioritizing visible editors and controls;
- stable per-snapshot element IDs;
- role, accessible name, state, value, link, and viewport geometry;
- a page fingerprint and injection-risk flag.

Before a model request, elements are ranked against meaningful goal terms and capped again. Raw page snapshots are never copied into action history. The active working set contains the six newest compact action records, while older steps become short state-transition summaries. Completed task outcomes, final locations, and bounded action summaries are stored locally in `backend/data/session_memory.json` and recalled by browser-tab session. Mutable page state must always be re-observed.

The side-panel transcript is a separate audit layer. Up to 400 entries are retained in local extension storage, 80 are rendered at once, and older entries can be progressively revealed. An SSE event cursor allows a closed and reopened panel to resume an active task without replaying completed browser actions.

This follows Anthropic's context-engineering hierarchy: clear bulky old tool results first, compact older trajectory details, and retain structured memory outside the active context. It does not spend an additional model call on every compaction.

## Fast pace without sacrificing accuracy

- DOM extraction is local and synchronous; raw HTML never crosses the API.
- SSE pushes actions immediately rather than polling.
- The HTTP model client uses connection pooling and bounded timeouts.
- Model choice, reasoning effort, text budget, and page-context budget change together by mode.
- Navigation waits for the new document and returns a fresh snapshot in one round trip.
- Verification is deterministic where possible: execution success, fingerprint change, navigation state, and explicit page evidence.

For production, the next performance step is a Redis-backed task/event store plus multiple stateless API workers. The in-memory store is intentional for this local alpha.

## Security boundaries

- API credentials stay only in the backend environment.
- The extension asks for page origins at task time.
- Page instructions are flagged and remain untrusted.
- High-impact actions require explicit one-time approval.
- Chrome internal pages remain inaccessible by browser policy.
- No arbitrary JavaScript execution tool is exposed to the model.
- No cookie-reading, debugger, native messaging, or filesystem capability exists in this alpha.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service/provider/model readiness |
| POST | `/v1/tasks` | Create an agent task |
| GET | `/v1/tasks/{id}` | Task status |
| GET | `/v1/tasks/{id}/stream` | SSE event stream |
| POST | `/v1/tasks/{id}/actions/{action}/result` | Browser observation |
| POST | `/v1/tasks/{id}/approvals/{action}` | Human decision |
| POST | `/v1/tasks/{id}/cancel` | Cooperative cancellation |
