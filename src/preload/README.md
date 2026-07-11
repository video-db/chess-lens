# Preload

This folder contains Electron preload scripts.

Preload code exposes safe, typed APIs from the isolated renderer context to the Electron main process through `contextBridge` and IPC. Keep privileged Electron access here instead of importing Electron directly in React components.
