# Renderer API

This folder contains renderer-side API adapters.

`ipc.ts` wraps preload-exposed Electron IPC APIs, while `trpc.ts` creates the typed client for the local main-process server. React components and stores should use these adapters instead of raw transport calls.
