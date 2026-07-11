# Tools

This folder contains developer utilities grouped by purpose.

- `validation/`: local/CI smoke checks that protect launch-critical chess behavior.
- `diagnostics/`: one-off model, latency, log, and benchmark investigation tools.
- `maintenance/`: recovery and export inspection helpers for VideoDB sessions.
- `assets/`: asset-generation scripts, such as icon regeneration.

`validation/validate_project_frames.ts` is the launch smoke check for the pre-recorded chess fixture under `test-data/fixtures/project-frames`. It validates known invalid frame outputs and requires the exact replayed move-history snapshot, so it should stay in CI/local verification.

`validation/validate_postgame_fixture.ts` builds on the same frame fixture and checks the post-game analysis contract: concrete SAN moves, non-empty gameplay tips, key moment selection, move labels, jump timestamps, and insight topics.
