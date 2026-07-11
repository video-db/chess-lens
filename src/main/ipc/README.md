# IPC

This folder contains Electron IPC handlers for renderer-to-main communication.

Each file groups channels for a feature area such as capture, calendar, copilot, live assist, MCP, visual index, workflows, or widget control. Capture websocket listeners and channel-selection helpers live beside the capture IPC handler so recorder setup stays separate from transcript, visual-index stream forwarding, and platform-specific channel mapping. IPC handlers should validate requests and delegate work to main-process services.
