# Main Libraries

This folder contains main-process utility modules and low-level pipeline helpers.

Root files are cross-cutting runtime helpers such as logging, paths, runtime config, VideoDB patches, and pipeline latency tracking.

Subfolders group reusable helpers by function:

- `chess/`: chess rules, FEN utilities, canonical move history, and board-plausibility checks.
- `vision/`: board detection, screenshot/FEN extraction helpers, visual-index normalization, and visual text filtering.
- `llm/`: low-level LLM response parsers and JSON cleanup helpers.

Keep reusable non-UI logic here when it is specific to the Electron main process.
