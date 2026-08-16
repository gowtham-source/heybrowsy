# heybrowsy

A local-first Chrome extension that acts as an AI-powered browser work agent. It lives in a side panel, reads semantic page context, executes browser actions through a background bridge, and coordinates everything through a stateful FastAPI backend.

## Features

- **Manifest V3 side panel** — open with `Ctrl+Shift+Y`
- **On-demand page permissions** — no blanket install-time host access
- **Semantic page snapshots** — visible text, ARIA names, roles, form fields, links, and viewport geometry
- **Browser tools** — read, click, type, select, scroll, and navigate
- **Tab group integration** — active tasks attach to a colored tab group with a glow ring, action label, and animated agent cursor
- **Streaming progress** — FastAPI task API with SSE events for reasoning, actions, approvals, and verification
- **Plan → act → observe → verify loop** with bounded retries and a configurable step budget
- **Multi-provider model routing** — OpenAI, Anthropic, and Google with per-mode selection and automatic fallback
- **Approval gates** — submissions, publishing, deletion, purchases, sensitive typing, and sensitive domains require human confirmation
- **Safety** — web content isolation, prompt-injection detection, no arbitrary JS execution
- **Demo mode** — test the full extension ↔ backend transport without any API keys

## Getting started

### 1. Start the backend

#### Using uv (recommended)

```bash
cd backend
cp .env.example .env
# Add one or more of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.
# Leave all blank for safe demo mode.

uv sync               # creates .venv and installs deps
uv run run.py
```

#### Using pip

```bash
cd backend
python -m venv .venv
# Windows
.\.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

cp .env.example .env
# Add one or more of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.
# Leave all blank for safe demo mode.

pip install -e .
python run.py
```

The API listens on `http://127.0.0.1:8765`. Explore it at `/docs` or check `/health`.

### 2. Load the extension

```bash
cd extension
npm install      # first time only
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist`
4. Click the heybrowsy toolbar icon or press `Ctrl+Shift+Y`

Starting a task attaches the current tab to a green **heybrowsy** group; any tabs the agent opens join the same group.

To rebuild after a source change:

```bash
cd extension
npm run build
```

Then click **Reload** on the heybrowsy card in `chrome://extensions`.

## Multi-provider model routing

| Provider  | Fast                       | Balanced          | Accurate                              |
|-----------|----------------------------|--------------------|---------------------------------------|
| OpenAI    | `gpt-5.6-luna`             | `gpt-5.6-terra`    | `gpt-5.6-sol`                         |
| Anthropic | `claude-haiku-4-5-20251001`| `claude-sonnet-5`  | `claude-sonnet-5`                     |
| Google    | `gemini-3.5-flash-lite`    | `gemini-3.6-flash` | `gemini-3.6-flash` with high thinking |

All model names are environment-configurable. Each provider uses its native SDK — OpenAI Responses API, Anthropic async Messages SDK, Google async Interactions SDK — but every response is validated against the same `AgentDecision` Pydantic schema. Keys stay server-side and are never exposed to the extension or page.

### Provider routing

Set `HEYBROWSY_PROVIDER=auto` to try providers in `HEYBROWSY_PROVIDER_FALLBACK_ORDER`, or pin each speed mode independently:

```dotenv
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...

HEYBROWSY_FAST_PROVIDER=gemini
HEYBROWSY_BALANCED_PROVIDER=anthropic
HEYBROWSY_ACCURATE_PROVIDER=openai
HEYBROWSY_PROVIDER_FALLBACK_ORDER=openai,anthropic,gemini
HEYBROWSY_PROVIDER_FALLBACKS=true
```

If a provider times out, rejects a model, or returns an invalid response, the router tries the next configured provider. Set `HEYBROWSY_PROVIDER_FALLBACKS=false` for strict single-provider behavior. `/health` reports configured providers, primary routes, and fallback models without exposing keys.

## Commands

```bash
# Extension
cd extension
npm run build
npm run test

# Backend (with uv)
cd backend
uv run -m pytest -q

# Backend (with pip/venv)
cd backend
.venv/Scripts/python -m pytest -q   # Windows
.venv/bin/python -m pytest -q        # macOS / Linux
```

## Project structure

```
heybrowsy/
├── backend/
│   ├── heybrowsy/       # FastAPI app, harness, providers, security
│   ├── tests/
│   ├── .env.example
│   ├── pyproject.toml
│   └── run.py
├── extension/
│   ├── src/             # TypeScript — side panel, background, content script
│   ├── public/          # Manifest, icons
│   ├── dist/            # Build output (gitignored)
│   └── package.json
├── ARCHITECTURE.md
└── README.md
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the harness, provider, context, and safety design. All available environment options are documented in [`backend/.env.example`](./backend/.env.example).

## License

MIT
