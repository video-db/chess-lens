# Services

This folder contains main-process domain services for Chess Lens.

Services encapsulate long-running workflows and integrations: screen capture, chess analysis, VideoDB export, live assist, calendar polling, session recovery, recording export, tray behavior, and LLM-powered summaries.

Feature-specific helper folders keep large services focused:

- `calendar/`: Google auth, Google Calendar API access, and calendar polling/notification logic.
- `chess/`: chess engine analysis, screenshot capture, and screenshot-specific guard/constants helpers.
- `copilot/`: sales copilot behavior, conversation metrics, nudges, summaries, and transcript buffering.
- `live-assist/`: prompts, prompt builders, coaching-response parsing, constants, DTO types, engine text helpers, FEN/turn parsing, position-history filtering, and win-probability helpers for `live-assist.service.ts`.
- `llm/`: LLM request orchestration, DTOs, and OpenAI message/tool conversion.
- `mcp/`: MCP inference, authentication, client connections, health checks, tool aggregation, intent detection, result handling, and orchestration.
- `meeting-setup/`: setup prompts and checklist/question generation.
- `recording/`: export polling, markdown export, recording export recovery, and startup session recovery.
- `workflow/`: webhook delivery for configured workflows.

Root files are app-level services used across multiple feature folders: Live Assist orchestration, VideoDB access, session event emission, and tray behavior. IPC and tRPC layers should call into these services rather than duplicating business logic.
