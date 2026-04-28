# Chess Lens

**Real-time chess analysis and move coaching — directly on your screen.**

Chess Lens is a desktop application that watches your chess game through screen capture, extracts the board position as a FEN, queries a chess engine for the best move and evaluation, and delivers a concise coaching tip to a floating overlay — all within seconds of each move.

[![Electron](https://img.shields.io/badge/Electron-34-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## How It Works

```
Screen capture
    ↓ every 3 seconds
VideoDB visual indexing (reads the board, outputs FEN)
    ↓
chess-api.com engine (best move + evaluation + top lines)
    ↓
LLM coaching layer (explains the move in plain language)
    ↓
Floating overlay (coaching tip appears on screen)
```

1. **Screen capture** — Chess Lens records your display continuously using the VideoDB capture SDK.
2. **Board extraction** — Every 3 seconds a frame is sent to VideoDB's visual indexing pipeline with a chess-specific prompt. The model scans the board row-by-row, determines perspective (white or black at the bottom), and outputs a raw FEN board string.
3. **FEN validation** — The app validates the extracted FEN for structural correctness, piece count sanity, and pawn placement rules before using it.
4. **Engine analysis** — The validated FEN is sent to [chess-api.com](https://chess-api.com) with depth 12, returning the best move in SAN/LAN, centipawn evaluation, mate distance, and top 5 continuation lines.
5. **LLM coaching** — The board context and engine output are passed to an LLM (via VideoDB's OpenAI-compatible proxy) which writes a concise paragraph explaining *why* the best move is strong — threats, king safety, piece activity, forcing lines.
6. **Overlay display** — The coaching tip appears in a frameless, always-on-top floating window that stays visible over your chess client without stealing focus.

New tips are generated only when the board position changes (FEN signature deduplication), so you get one tip per move, not a stream of noise.

---

## Features

- **Automatic FEN extraction** — Reads any chess board from a screenshot. Works with chess.com, lichess, ChessBase, or any client displayed on screen. Handles both white-bottom and black-bottom perspectives.
- **Engine-backed tips** — Every tip is grounded in actual engine analysis (best move, eval, top lines) rather than generic advice.
- **LLM explanation** — The engine output is translated into readable coaching language: tactical motifs, positional ideas, and concrete threats.
- **Floating HUD overlay** — Transparent, frameless, always-on-top window. Draggable, position-persisted across sessions. Never steals focus from your game.
- **Position deduplication** — Tips are only regenerated when the board position genuinely changes. The same position never triggers duplicate tips.
- **Engine fallback** — If the LLM is unavailable, the raw engine summary (best move + eval) is shown directly so you always have something useful.
- **Session history** — All sessions are saved locally. Browse past games, review coaching tips, and replay the visual index.
- **Local-first storage** — SQLite database on your machine. No data leaves your device except for the API calls to VideoDB and chess-api.com.

---

## Quick Install

**macOS** (Apple Silicon & Intel):
```bash
curl -fsSL https://artifacts.videodb.io/chess-lens/install | bash
```

After installation:
1. Open **Chess Lens** from Applications or Spotlight
2. Grant **Microphone** and **Screen Recording** permissions when prompted
3. Enter your [VideoDB API key](https://console.videodb.io)
4. Start a chess session — the overlay appears automatically when recording begins

> Currently available for macOS. Windows and Linux support coming soon.

---

## Prerequisites

- **macOS 12+** (Monterey or later)
- **VideoDB API key** — [console.videodb.io](https://console.videodb.io) (free tier available)
- **Permissions** — Microphone and Screen Recording (required for capture)

For development: Node.js 18+ and npm 10+

---

## Getting Started (Developers)

**1. Clone and install:**
```bash
git clone https://github.com/video-db/chess-lens.git
cd chess-lens
npm install
```

**2. Rebuild native modules for Electron:**
```bash
npm run rebuild
```

**3. Start development mode:**
```bash
npm run dev
```

**4. Register** with your VideoDB API key when the app opens.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev mode (main + renderer with hot reload) |
| `npm run build` | Build TypeScript and React for production |
| `npm run dist:mac` | Package macOS DMG |
| `npm run typecheck` | Run TypeScript type checking across all targets |
| `npm run lint` | Run ESLint |
| `npm run rebuild` | Rebuild native modules for Electron's Node ABI |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate` | Apply database migrations |

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
- **tRPC over HTTP** — typed CRUD operations (recordings, settings, auth)
- **IPC** — event push from main to renderer (visual index events, coaching tips, recorder state)
- **EventEmitter** — internal service decoupling within the main process
- **WebSocket** — VideoDB SDK streams for visual indexing

### Project Structure

```
src/
├── main/                        # Electron main process
│   ├── db/                      # Drizzle ORM schema + all CRUD operations
│   ├── ipc/                     # IPC handlers (capture, live-assist, widget, …)
│   ├── lib/                     # Logger, config, paths, VideoDB patches
│   ├── server/                  # Hono HTTP server + tRPC router
│   │   └── trpc/procedures/     # auth, capture, recordings, transcription,
│   │                            #   visualIndex, settings, token, meetingSetup
│   └── services/
│       ├── chess-engine.service.ts   # chess-api.com wrapper (FEN → best move)
│       ├── live-assist.service.ts    # Core coaching engine (FEN extraction,
│       │                             #   engine calls, LLM, overlay events)
│       ├── llm.service.ts            # OpenAI SDK via VideoDB proxy
│       ├── videodb.service.ts        # VideoDB SDK wrapper
│       └── copilot/                  # Post-session summary generation
├── preload/                     # contextBridge scripts (main window + widget)
├── renderer/                    # React frontend
│   ├── components/
│   │   ├── recording/           # Recording controls, live assist panel
│   │   ├── history/             # Session history and review
│   │   ├── settings/            # Settings view
│   │   └── …
│   ├── hooks/                   # useSession, useLiveAssist, useGlobalRecorderEvents, …
│   ├── stores/                  # Zustand (session, live-assist, visual-index, …)
│   └── widget/                  # Floating HUD overlay app (separate entry point)
│       └── components/
│           └── PairCompactOverlay.tsx   # Main overlay UI
└── shared/                      # Shared between main + renderer
    ├── config/game-coaching.ts  # Chess coaching profile (prompts, timing)
    ├── schemas/                 # Zod validation schemas
    └── types/                   # TypeScript type definitions
```

### Key Files

| File | Role |
|---|---|
| `src/main/services/live-assist.service.ts` | Core coaching engine — FEN extraction, engine calls, LLM, tip deduplication |
| `src/main/services/chess-engine.service.ts` | HTTP client for chess-api.com |
| `src/shared/config/game-coaching.ts` | Chess visual indexing prompt and timing parameters |
| `src/renderer/widget/components/PairCompactOverlay.tsx` | Floating HUD overlay UI |
| `src/main/server/trpc/procedures/visual-index.ts` | Visual indexing tRPC procedure (start/pause/resume/clear) |
| `src/main/ipc/capture.ts` | Recording engine — CaptureClient lifecycle, WebSocket streams |

---

## The Coaching Pipeline in Detail

### FEN Extraction

The visual indexing prompt instructs the model to:
1. Determine board perspective (`<perspective>white</perspective>` or `black`)
2. Scan each row visually from top to bottom, left to right
3. Output each row as a FEN rank string inside `<board_mapping>` tags
4. Combine rows into a raw board string inside `<raw_board>` tags

The app then:
- Parses the `<raw_board>` tag and verifies each rank sums to exactly 8 squares
- Applies perspective correction (flips rank order and reverses each rank for black-bottom boards)
- Validates the resulting FEN for structural correctness (piece symbols, king count, pawn placement)
- Adds synthetic side-to-move / castling / en-passant fields (`w - - 0 1`) since these cannot be reliably inferred from a single frame

### Position Deduplication

To avoid generating identical tips on every poll interval, the app tracks a **chess signature** — the board portion of the FEN (before the space). A new tip is only generated when:

1. A valid FEN is visible in the current frame window
2. The board signature differs from the last generated tip's signature
3. The same new signature has been seen at least twice consecutively (stabilisation check to filter transient mis-reads)

### Engine Call

```
chess-api.com POST /v1
  { fen, variants: 5, depth: 12, maxThinkingTime: 50 }

Response:
  { san, lan, eval, mate, continuationArr, variants: [...] }
```

The engine summary passed to the LLM includes: best move in SAN, centipawn evaluation, mate distance (if applicable), and top 5 continuation lines.

### LLM Coaching

The LLM receives:
- The raw visual index text (recent frames)
- The validated FEN
- The engine summary (best move + eval + top lines)

It returns a JSON object:
```json
{
  "say_this": "paragraph explaining the best move and its idea",
  "ask_this": "one short drill sentence"
}
```

`say_this` is displayed as the main coaching tip in the overlay. `ask_this` is shown below as a drill prompt.

---

## Data Storage

All application data is stored locally:

```
~/Library/Application Support/chess-lens/
├── data/
│   └── chess-lens.db          # SQLite database (recordings, transcripts, visual index)
├── logs/
│   └── app-YYYY-MM-DD.log  # Daily log files
├── config.json             # App configuration
├── google_tokens.enc       # Google OAuth tokens (encrypted)
└── .mcp-encryption-key     # AES-256-GCM key for MCP credentials
```

Nothing is uploaded to any server except:
- Screen frames → VideoDB visual indexing API (for FEN extraction)
- FEN strings → chess-api.com (for engine analysis)
- Coaching prompts → LLM via VideoDB proxy

---

## Permissions (macOS)

| Permission | Why |
|---|---|
| **Screen Recording** | Capture screen frames for board extraction |
| **Microphone** | Optional — for session audio recording |

Grant in **System Settings → Privacy & Security**.

---

## Troubleshooting

**Overlay not showing coaching tips:**
- Ensure Screen Recording permission is granted
- Check that the chess board is clearly visible and not obscured
- Wait for the first tip — FEN extraction and engine calls take ~5 seconds on first move
- Check logs at `~/Library/Application Support/chess-lens/logs/`

**"Unauthorized access to session" on start:**
- Your session token may be stale — stop and restart the recording
- Verify your VideoDB API key is valid at [console.videodb.io](https://console.videodb.io)

**FEN not being extracted:**
- The board must be at least ~400px wide on screen
- Ensure no overlays (menus, modals) are covering the board at the moment of capture
- Both white-at-bottom and black-at-bottom perspectives are supported

**Development — native module errors:**
```bash
npm run rebuild
```

**Development — app won't start:**
- Ensure Node.js 18+ is installed
- Delete `dist/` and re-run `npm run dev`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 34 |
| Language | TypeScript 5.8 |
| Frontend | React 19, Vite 6, Tailwind CSS 3.4, shadcn/ui |
| State | Zustand 5, TanStack Query 5 |
| Backend | Hono 4, tRPC 11 |
| Database | Drizzle ORM + better-sqlite3 (SQLite) |
| Capture | `@videodb/recorder` (native binary), VideoDB SDK 0.2.4 |
| Chess engine | chess-api.com REST API |
| LLM | OpenAI SDK 6 via VideoDB proxy |
| Logging | Pino + pino-pretty |

---

## Community & Support

- **Issues:** [GitHub Issues](https://github.com/video-db/chess-lens/issues)
- **Discord:** [Join the VideoDB community](https://discord.gg/py9P639jGz)
- **API Key:** [VideoDB Console](https://console.videodb.io)
- **Docs:** [docs.videodb.io](https://docs.videodb.io)

---

<p align="center">Built with the <a href="https://videodb.io">VideoDB</a> platform</p>
