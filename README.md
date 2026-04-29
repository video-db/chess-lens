# Chess Lens

**Real-time chess analysis and move coaching — directly on your screen.**

Chess Lens is a desktop application that watches your chess game through continuous screen capture, extracts the board position as a FEN string using a vision-language model, queries a chess engine for the best move and evaluation, and delivers a concise coaching tip to a floating always-on-top overlay — all within seconds of each move.

[![Electron](https://img.shields.io/badge/Electron-34-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## How It Works

```
Screenshot (every 1 second via Electron desktopCapturer)
    ↓
gpt-5.4 vision model (board → structured XML → FEN)
    ↓
Majority-vote confirmation (2-of-2 readings must agree)
    ↓
chess-api.com engine at depth 12 (best move + eval + top lines)
    ↓  [Stage 1: instant]
Engine-only tip shown immediately in floating overlay
    ↓  [Stage 2: background]
LLM coaching layer (plain-language explanation + drill)
    ↓
Overlay upgrades with full coaching tip
```

1. **Screen capture** — A full screenshot is taken every second using Electron's `desktopCapturer`. No separate recording binary is needed for FEN extraction.
2. **Board extraction** — Each screenshot is base64-encoded and sent to `openai/gpt-5.4` via the VideoDB proxy. The model scans the board row-by-row, determines perspective (white or black at bottom), and returns structured XML: `<perspective>`, `<board_mapping>`, `<raw_board>`, and `<turn>` tags.
3. **Majority-vote confirmation** — A new FEN is only promoted to the coaching pipeline once it appears in 2 of the last 2 consecutive readings. Single-frame glitches or mid-animation captures are discarded. After a new FEN is confirmed, 2 rapid burst captures at 500 ms intervals fill the vote window quickly.
4. **FEN validation** — The confirmed FEN is validated for structural correctness (8 ranks, valid symbols), piece count sanity, king count (exactly 1 per side), and pawn placement before it proceeds.
5. **Engine analysis** — The validated FEN is sent to [chess-api.com](https://chess-api.com) at depth 12, returning the best move in SAN and LAN, centipawn evaluation, mate distance, and top 5 continuation lines.
6. **Two-stage tip emission** — An engine-only tip is emitted to the overlay immediately (no LLM wait). Separately, the FEN and engine summary are sent fire-and-forget to the `pro` LLM via `collection.generateText()` to produce a plain-language coaching explanation. When the LLM responds, the overlay tip upgrades in place.
7. **Position deduplication** — The board portion of the FEN (the signature) is compared to the last processed position. A new tip is only generated when the signature changes, so you get exactly one tip per move.

---

## Features

- **Automatic FEN extraction** — Reads any chess board from a screenshot. Works with chess.com, lichess, ChessBase, or any client on screen. Handles white-bottom and black-bottom perspectives automatically.
- **Majority-vote accuracy** — The 2-of-2 vote window eliminates single-frame OCR errors and mid-animation captures before they reach the engine.
- **Two-stage coaching tips** — An instant engine tip appears within seconds; the LLM-enhanced explanation upgrades it in the background without blocking the UI.
- **Engine-backed analysis** — Every tip is grounded in chess-api.com analysis at depth 12: best move, centipawn eval, mate distance, top 5 lines.
- **Perspective-aware display** — The overlay chessboard always renders from the player's perspective. The engine receives a white-perspective FEN internally while the display FEN is flipped for black players.
- **Floating HUD overlay** — Transparent, frameless, always-on-top Electron window with an inline SVG chessboard, coaching tip, drill question, and session controls. Draggable; position is persisted across sessions.
- **Engine fallback** — If the LLM is unavailable or times out, the formatted engine summary (best move + eval) is shown permanently so you always get a useful tip.
- **Session history** — All sessions are saved locally. Browse past games, review coaching tips, and replay the visual index from the History tab.
- **Post-session summary** — A copilot service generates a session summary from the accumulated coaching tips after each game.
- **MCP integration** — Connect external MCP servers (CRMs, search tools, databases) for additional context during sessions.
- **Google Calendar integration** — Polls for upcoming meetings, sends pre-meeting notifications, and can auto-start recording.
- **Local-first storage** — SQLite on your machine. No data leaves the device except API calls to VideoDB (FEN extraction), chess-api.com (engine), and the LLM proxy.
- **Debug mode** — `CHESS_DEBUG_FRAMES=1` saves every screenshot + extraction result + vote state to `<userData>/fen-debug/` for diagnosis.

---

## Prerequisites

- **macOS 12+** (Monterey or later) — packaged for both x64 and arm64
- **VideoDB API key** — [console.videodb.io](https://console.videodb.io) (free tier available)
- **Permissions** — Screen Recording and Microphone (grant in System Settings → Privacy & Security)

For development: Node.js 18+ and npm 10+

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/video-db/chess-lens.git
cd chess-lens
npm install
```

`npm install` automatically runs `electron-rebuild` via the `postinstall` hook to compile `better-sqlite3` for Electron's Node ABI.

### 2. Rebuild native modules (if needed)

```bash
npm run rebuild
```

Run this if you see native module errors after install, or after upgrading Node/Electron.

### 3. Start development mode

```bash
npm run dev
```

This compiles the main process TypeScript, starts the Vite dev server on port 51730, and launches Electron.

### 4. Register

On first launch, enter your VideoDB API key in the Auth screen. The key is stored in `config.json` in `~/Library/Application Support/chess-lens/`.

**Auto-registration:** Place an `auth_config.json` in the app directory before launch:

```json
{ "apiKey": "vdb_...", "name": "Your Name" }
```

The app consumes and deletes this file on startup.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development mode (main + renderer with hot reload) |
| `npm run build` | Full production build (main + renderer) |
| `npm run build:main` | Compile main process TypeScript only |
| `npm run build:renderer` | Vite build for renderer only |
| `npm run dist` | Build + package all platforms |
| `npm run dist:mac` | Build + package macOS DMG (x64 + arm64) |
| `npm run typecheck` | TypeScript type checking for both tsconfig targets |
| `npm run lint` | ESLint across all `.ts` / `.tsx` files |
| `npm run rebuild` | Rebuild native modules for Electron's Node ABI |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate` | Apply database migrations |
| `npm run tools:check-model` | Test vision model availability |
| `npm run tools:check-export` | Check a VideoDB session export status |
| `npm run tools:recover-session` | Manually recover a stuck processing session |

---

## Architecture

Chess Lens is a multi-process Electron application with three runtime contexts:

```
┌─────────────────────────────────────────────────────────┐
│  Main Process (Node.js / CommonJS)                      │
│  Services → IPC Handlers → Hono/tRPC HTTP :51731        │
│  SQLite (Drizzle ORM)                                   │
└──────────────┬──────────────────────────┬───────────────┘
    contextBridge (IPC events)    HTTP tRPC (CRUD)
┌──────────────┴──────────────────────────┴───────────────┐
│  Renderer (React + Vite, sandboxed)                     │
│  Zustand stores ← hooks ← IPC events / tRPC queries     │
└──────────────┬──────────────────────────────────────────┘
    widgetAPI contextBridge
┌──────────────┴──────────────────────────────────────────┐
│  Widget Window (always-on-top, transparent HUD)         │
│  Floating chess coaching overlay                        │
└─────────────────────────────────────────────────────────┘
```

**Communication patterns:**
- **tRPC over HTTP** — typed CRUD (recordings, settings, auth, transcription, visual-index, tokens, meeting-setup)
- **Electron IPC** — event push from main to renderer (coaching tips, FEN updates, recorder state, MCP results, calendar events)
- **EventEmitter** — internal service decoupling within the main process (`LiveAssistService` emits `insights` and `fen` events)
- **WebSocket** — VideoDB SDK streams for real-time transcript (mic + system_audio) and visual indexing (screen channel)

---

## Project Structure

```
src/
├── main/                              # Electron main process (Node.js)
│   ├── db/                            # Drizzle ORM schema + all CRUD exports
│   ├── ipc/
│   │   ├── capture.ts                 # Recording engine: CaptureClient lifecycle, WebSocket streams
│   │   ├── live-assist.ts             # Live assist + MCP start/stop, FEN forwarding
│   │   └── widget.ts                  # Widget window state relay
│   ├── lib/                           # Logger (Pino), config R/W, path helpers
│   ├── server/trpc/procedures/        # tRPC: auth, capture, recordings, settings, …
│   └── services/
│       ├── chess-screenshot.service.ts  # Screenshot loop + majority-vote FEN extraction
│       ├── chess-engine.service.ts      # chess-api.com HTTP client
│       ├── live-assist.service.ts       # Core coaching engine (FEN → engine → LLM → overlay)
│       ├── llm.service.ts               # OpenAI SDK via VideoDB proxy (vision + coaching)
│       ├── mcp-inference.service.ts     # MCP agentic loop (transcript → tool calls)
│       ├── videodb.service.ts           # VideoDB SDK wrapper
│       └── copilot/                     # Post-session summary generation
├── preload/
│   ├── index.ts                       # contextBridge for main window (electronAPI)
│   └── widget.ts                      # contextBridge for widget window (widgetAPI)
├── renderer/
│   ├── components/
│   │   ├── recording/                 # RecordingHeader, LiveAssistPanel, MetricsBar, …
│   │   ├── history/                   # HistoryView, session review
│   │   ├── settings/                  # SettingsView, MCP server management
│   │   └── …
│   ├── hooks/                         # useSession, useLiveAssist, useGlobalRecorderEvents, …
│   ├── stores/                        # Zustand: session, live-assist, visual-index, mcp, …
│   └── widget/                        # Floating HUD overlay (separate Vite entry point)
│       └── components/
│           └── PairCompactOverlay.tsx # Main overlay UI: board + tip + controls
└── shared/
    ├── config/game-coaching.ts        # Chess coaching profile: prompts, timing, FEN extraction
    ├── schemas/                       # Zod validation schemas
    └── types/                         # Shared TypeScript types
```

### Key Files

| File | Role |
|---|---|
| `src/main/services/chess-screenshot.service.ts` | Screenshot loop, majority-vote FEN confirmation, burst captures |
| `src/main/services/live-assist.service.ts` | Core coaching engine — FEN extraction, engine calls, LLM, tip deduplication, overlay events |
| `src/main/services/chess-engine.service.ts` | HTTP client for chess-api.com |
| `src/main/services/llm.service.ts` | OpenAI SDK pointing at VideoDB proxy (vision FEN extraction + coaching) |
| `src/shared/config/game-coaching.ts` | Vision prompt (4-step board reading), timing parameters, coaching system prompt |
| `src/renderer/widget/components/PairCompactOverlay.tsx` | Floating HUD overlay UI |
| `src/main/ipc/capture.ts` | Recording pipeline: CaptureClient lifecycle, WebSocket streams |
| `src/main/ipc/live-assist.ts` | IPC handlers: start/stop live assist and MCP inference |

---

## The Coaching Pipeline in Detail

### Screenshot and FEN Extraction

`ChessScreenshotService` fires every **1 second** using Electron's `desktopCapturer`. Each full-screen PNG is base64-encoded and sent to `openai/gpt-5.4` via the VideoDB proxy.

The model follows a 4-step prompt in `game-coaching.ts`:
1. Determine board perspective (`<perspective>white</perspective>` or `black`)
2. Scan each row visually (top-to-bottom, left-to-right), verifying exactly 8 squares per row → `<board_mapping>` tags
3. Combine rows into a raw FEN board string → `<raw_board>` tag
4. Identify whose turn it is from the last-move highlight → `<turn>` tag

The app then validates the extracted FEN: structural correctness, piece count sanity (material limits), king count (exactly 1 per side), no pawns on ranks 1 or 8. Perspective correction is applied for black-bottom boards. Synthetic fields `w - - 0 1` are appended since castling rights and en-passant cannot be inferred from a single frame.

### Majority-Vote Confirmation

```
Reading 1 → push to vote buffer (window = 2)
Reading 2 → push to vote buffer
              ↓
    Both match? → promote FEN to pipeline
    No match?  → wait for next reading
```

After a new FEN is confirmed, 2 rapid burst captures fire at 500 ms intervals to fill the window quickly for the next move.

### Position Deduplication

A new coaching tip is only generated when the **board signature** (the FEN board string before the space) differs from the last processed position. The same position never triggers a duplicate tip.

### Engine Analysis

```
POST https://chess-api.com/v1
Body: { fen, variants: 5, depth: 12, maxThinkingTime: 50 }

Response: { san, lan, eval, mate, continuationArr, variants: [...] }
```

Timeout: 2 seconds. The engine summary passed to the LLM includes: best move in SAN and LAN, centipawn evaluation, mate distance (if applicable), and top 5 continuation lines.

### Two-Stage Tip Emission

**Stage 1 — immediate:** As soon as the engine responds, an engine-only tip is shown in the overlay:
```
White to move: play Nf6 — White is better (+0.45)
```

**Stage 2 — background:** The FEN and engine summary are sent fire-and-forget to the `pro` LLM via `collection.generateText()`. The LLM returns:
```json
{
  "say_this": "Play Nf6 to fork the queen and rook while activating your knight on a strong outpost.",
  "ask_this": "What would you do if Black captures the knight on f6?"
}
```

`say_this` replaces the engine tip in the overlay. `ask_this` appears as a drill prompt. Stale LLM responses (position already changed) are discarded automatically.

---

## Configuration

### `config.json` (user data directory)

Stored at `~/Library/Application Support/chess-lens/config.json`. Written by the app at registration and when widget position is saved.

```json
{
  "accessToken": "...",
  "userName": "Your Name",
  "apiKey": "vdb_...",
  "litellmKey": "",
  "widgetPosition": { "x": 100, "y": 100 }
}
```

### `runtime.json` (app directory)

For deployment or self-hosted overrides. Place alongside the app binary or in `resources/` when building.

```json
{
  "apiUrl": "https://api.videodb.io",
  "apiPort": 51731,
  "chessEngineApiUrl": "https://chess-api.com",
  "litellmBaseUrl": "",
  "litellmModel": ""
}
```

### Environment variables

| Variable | Description |
|---|---|
| `CHESS_DEBUG_FRAMES=1` | Save every screenshot + LLM result + vote state to `<userData>/fen-debug/` |
| `VITE_DEV_SERVER_PORT` | Override the Vite dev server port (default: 51730) |

---

## Data Storage

All application data is stored locally:

```
~/Library/Application Support/chess-lens/
├── data/
│   └── chess-lens.db          # SQLite database (recordings, transcripts, visual index,
│                              #   MCP servers, calendar preferences, workflows)
├── logs/
│   └── app-YYYY-MM-DD.log    # Daily Pino log files
├── config.json                # App config (API key, access token, widget position)
├── google_tokens.enc          # Google OAuth tokens (AES-256-GCM via Electron safeStorage)
└── .mcp-encryption-key        # AES-256-GCM key for MCP server credentials
```

**What leaves the device:**
- Full-screen PNG frames → VideoDB visual indexing API (`gpt-5.4` for FEN extraction)
- FEN strings → chess-api.com (engine analysis)
- Coaching prompts → LLM via VideoDB `collection.generateText()`

---

## Permissions (macOS)

| Permission | Why |
|---|---|
| **Screen Recording** | Capture screen frames every second for board extraction |
| **Microphone** | Optional — for session audio recording and transcription |

Grant in **System Settings → Privacy & Security**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 34 |
| Language | TypeScript 5.8 |
| Frontend | React 19, Vite 6, Tailwind CSS 3.4, shadcn/ui, Radix UI |
| State | Zustand 5, TanStack Query 5 |
| API layer | tRPC 11, Hono 4 |
| Database | Drizzle ORM + better-sqlite3 (SQLite) |
| Capture | `@videodb/recorder` (native binary), VideoDB SDK 0.2.4 |
| Vision model | `openai/gpt-5.4` via VideoDB proxy |
| Coaching model | `pro` via `collection.generateText()` |
| LLM client | OpenAI SDK 6 |
| Chess engine | chess-api.com REST API |
| MCP | `@modelcontextprotocol/sdk` 1.x |
| Logging | Pino + pino-pretty |
| Validation | Zod 3 |

---

## Troubleshooting

**No coaching tips appearing in the overlay:**
- Confirm Screen Recording permission is granted in System Settings → Privacy & Security
- Ensure the chess board is fully visible and not covered by other windows
- The first tip takes ~5–10 seconds (1 second screenshot → LLM vision → vote confirmation → engine → LLM coaching)
- Check logs at `~/Library/Application Support/chess-lens/logs/`
- Enable debug frame saving: set `CHESS_DEBUG_FRAMES=1` and inspect `<userData>/fen-debug/` to see what the vision model is receiving

**Tips keep showing the same position:**
- Position deduplication means a new tip only fires when the board signature changes
- Confirm pieces are actually moving; if the FEN vote window does not reach consensus the position is not promoted

**"Unauthorized access to session" on recording start:**
- Your session token may be stale — stop and restart the recording
- Verify your VideoDB API key at [console.videodb.io](https://console.videodb.io)

**FEN extraction always null:**
- The chess board must be clearly visible and at least ~400 px wide
- No overlays, menus, or modals should cover the board during capture
- Run `npm run tools:check-model` to verify the vision model is reachable

**Development — native module errors after install:**
```bash
npm run rebuild
```

**Development — app won't start:**
- Ensure Node.js 18+ is installed
- Delete `dist/` and re-run `npm run dev`
- Check that port 51731 (tRPC server) is not already in use

**Stuck session in "processing" state:**
```bash
npm run tools:recover-session
```

---

## Community & Support

- **Issues:** [GitHub Issues](https://github.com/video-db/chess-lens/issues)
- **Discord:** [Join the VideoDB community](https://discord.gg/py9P639jGz)
- **API Key:** [VideoDB Console](https://console.videodb.io)
- **Docs:** [docs.videodb.io](https://docs.videodb.io)

---

<p align="center">Built with the <a href="https://videodb.io">VideoDB</a> platform</p>
