# `@ticketpm/discordjs`

Adapters for converting discord.js objects into `ticket.pm` transcript payloads.

## What this package adds

- Conversion from `Message`, `User`, `GuildMember`, `Role`, and channel-like objects into `@ticketpm/core` draft data.
- Cache-friendly context builders for already-fetched discord.js objects.
- Optional helper for paging backwards through channel history before export.

## Quick example

```ts
import { createDiscordJsTranscript, fetchMessagesUpToLimit } from "@ticketpm/discordjs";

const messages = await fetchMessagesUpToLimit(channel, 1000);
const transcript = createDiscordJsTranscript({
  messages,
  channel,
  guild: channel.guild
});
```
