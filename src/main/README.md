# Main Process

This folder contains the Electron main process for Chess Lens.

`index.ts` boots the desktop app, creates windows, starts the local server, initializes the database, registers IPC handlers, and coordinates app lifecycle cleanup. Feature implementation is split into `services/`, `ipc/`, `server/`, `db/`, `lib/`, `config/`, `utils/`, and `windows/`.
