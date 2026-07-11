# tRPC

This folder wires the local tRPC API used between the renderer and Electron main process.

`trpc.ts` defines shared tRPC primitives, `context.ts` builds per-request context, and `router.ts` composes the domain procedures from `procedures/`.
