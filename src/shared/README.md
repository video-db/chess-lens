# Shared

This folder contains code that is safe to share across app processes.

Shared config, schemas, types, and pure helper libraries live here. Avoid importing Electron, Node-only APIs, or browser-only UI code into this folder unless the file is explicitly scoped for one runtime.
