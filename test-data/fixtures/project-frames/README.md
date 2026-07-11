# Project Frames

This folder contains chessboard frame fixtures used to test and benchmark board detection.

The filenames encode frame numbers and expected board positions, making the images useful for regression checks around FEN extraction, board orientation, and move detection.

`npm run smoke:frames` replays these frames through the canonical move-history logic and requires the exact expected move snapshot `1. e4` and `2. d3`. This catches stale overlay/history regressions where skipped or noisy future frames leave phantom moves behind.
