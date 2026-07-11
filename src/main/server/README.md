# Server

This folder contains the local HTTP API server started by the Electron main process.

The server hosts the tRPC router that the renderer uses for structured app operations. Keep request transport setup here and place domain behavior in `services/` or `server/trpc/procedures/`.
