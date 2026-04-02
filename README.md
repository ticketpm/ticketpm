Monorepo for building, validating, proxying, compressing, and uploading `ticket.pm` transcript payloads.

## Workspace layout

- `@ticketpm/core`: shared transcript contract, canonical serialization, validation, compression, and ticket.pm upload/media clients.
- `@ticketpm/discord-api`: adapters for Discord API payloads and generic REST-style enrichment hooks.
- `@ticketpm/discordjs`: adapters for discord.js objects and cache-friendly context builders.

## Tooling

- Package manager and runtime: [Bun](https://bun.com/docs)
- Package runtime support: Bun preferred automatically, Node.js supported for the published packages
- Tests: Vitest, executed with `bun --bun vitest run`
- Build: TypeScript project references

## Commands

```bash
bun install
bun run build
bun --bun vitest run
```
