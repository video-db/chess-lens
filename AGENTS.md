# AGENTS.md

## Project Map
- Electron + Vite desktop app.
- Main process entry: `src/main/index.ts`.
- Preload entry: `src/preload/index.ts`.
- Renderer entry: `src/renderer/main.tsx`.
- Widget overlay entry: `src/renderer/widget.html`.
- Shared coaching policy lives in `src/shared/config/game-coaching.ts`.
- Main-process services live in `src/main/services/`.

## Verified Commands
- `npm run dev` = `npm run build:main` + Vite renderer + delayed Electron launch.
- `npm run build` = `npm run build:renderer && npm run build:main`.
- `npm run build:main` = `tsc -p tsconfig.node.json`.
- `npm run build:renderer` = `vite build`.
- `npm run typecheck` = `tsc --noEmit && tsc -p tsconfig.node.json --noEmit`.
- `npm run lint` = `eslint src --ext .ts,.tsx`.
- `npm run db:generate` = `drizzle-kit generate`.
- `npm run db:migrate` = `drizzle-kit migrate`.
- `npm run tools:check-model` = `tsx ./tools/checkModelAvailability.ts`.
- `npm run tools:simulate-pipeline-latency` = `tsx ./tools/simulatePipelineLatency.ts`.

## Repo-Specific Constraints
- Ask first before changing FEN voting ratios, pipeline thresholds, or coaching decision weights.
- Ask first before modifying contracts between `main`, `preload`, and `renderer`.
- Ask first before changing database schema or migration behavior.
- Ask first before changing any LLM prompt, model routing, or fallback policy.
- Keep edits minimal and file-local when possible.

## High-Signal Gotchas
- `vite.config.ts` uses a multi-page build with `src/renderer/index.html` and `src/renderer/widget.html`.
- `tsconfig.json` is renderer/shared only; `tsconfig.node.json` covers main/preload/shared.
- `drizzle.config.ts` points at `./src/main/db/schema.ts` and outputs to `./drizzle`.
- `fix-path()` runs at app startup in the main process.
- `EventEmitter.defaultMaxListeners` is raised to suppress noisy WebSocket warnings.
- `CHESS_DEBUG_FRAMES=1` enables screenshot/vote debugging.
