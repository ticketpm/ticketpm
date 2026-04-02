# `@ticketpm/discord-api`

Adapters for turning raw Discord API payloads into the compact transcript format expected by `ticket.pm`.

## What this package adds

- Conversion from `discord-api-types` message/user objects into `@ticketpm/core` draft messages.
- Context construction for already-enriched REST payloads.
- Optional callback-based enrichment for missing users, channels, guild members, roles, and poll voters.

## Quick example

```ts
import { createDiscordApiTranscript } from "@ticketpm/discord-api";

const transcript = createDiscordApiTranscript({
  messages,
  baseContext: {
    channel_id: "123",
    channels: {
      "123": { name: "support" }
    }
  }
});
```
