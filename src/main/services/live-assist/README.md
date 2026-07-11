# Live Assist Helpers

Purpose: feature-specific helper modules used by `../live-assist.service.ts`.

This folder keeps the live chess coaching pipeline out of the generic services
directory. The root service remains the public orchestrator.

Subfolders group helpers by pipeline concern:

- `coaching/`: prompt text, coaching tasks, JSON parsing, chat prompts, and insight specificity checks.
- `engine/`: engine state snapshots, engine move text, summary formatting, and win-probability snapshots.
- `fen/`: FEN events, turn resolution, RTStream conversion, side-to-move helpers, and related tests.
- `history/`: provisional and committed position-history filtering.
- `diagnostics/`: board diagnostics used when positions are rejected or ambiguous.

Root files are shared constants and DTO types used across those helper groups.
