# Database

This folder contains local database setup and schema definitions.

`index.ts` is the compatibility export surface for query helpers used across the main process. `connection.ts` owns the SQLite lifecycle, `bootstrap.ts` creates tables, indexes, compatibility columns, and startup schema repairs, `schema.ts` defines the Drizzle ORM tables, and `seeds.ts` owns default cue cards, playbooks, and settings. Feature-specific helpers live beside them, such as `mcp.ts` for MCP servers, tool calls, and OAuth tokens. Store persistent local app state here, not in renderer stores.
