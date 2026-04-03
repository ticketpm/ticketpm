# `@ticketpm/discord-api`

Adapters for turning raw Discord REST payloads into the compact transcript format expected by `ticket.pm`.

## What this package adds

- Conversion from `discord-api-types` message and user payloads into `@ticketpm/core` draft messages.
- Context builders for transcripts assembled from fetched REST data.
- Optional callback-based enrichment for missing users, channels, guild members, roles, and poll voters.
- One-shot helpers that normalize, sort, compact, and finalize transcripts.

## Install

```bash
bun add @ticketpm/discord-api
```

```bash
npm install @ticketpm/discord-api
```

## When to use this package

Use `@ticketpm/discord-api` when your integration works with raw Discord API payloads such as:

- gateway event payloads
- REST API responses
- persisted `APIMessage` objects from your own storage layer

If your integration uses `discord.js` objects, use `@ticketpm/discordjs` instead.

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

`createDiscordApiTranscript()` sorts messages chronologically before compact export.

## Enriched example

Use the enricher path when your messages reference users, channels, roles, or poll voters that are not already present in the payloads you collected.

```ts
import { createEnrichedDiscordApiTranscript } from "@ticketpm/discord-api";

const transcript = await createEnrichedDiscordApiTranscript({
  messages,
  channelId: "123",
  guildId: "456",
  enricher: {
    fetchUser: async (userId) => discordRest.users.get(userId),
    fetchChannel: async (channelId) => discordRest.channels.get(channelId),
    fetchGuildMember: async (guildId, userId) => discordRest.guildMembers.get(guildId, userId),
    fetchGuildRoles: async (guildId) => discordRest.guildRoles.list(guildId),
    fetchPollAnswerVoters: async ({ channelId, messageId, answerId }) =>
      discordRest.polls.listAnswerVoters(channelId, messageId, answerId)
  },
  baseContext: {
    channel_id: "123",
    channels: {
      "123": { name: "support" }
    }
  }
});
```

This package never performs HTTP requests on its own. All enrichment comes from the callbacks you provide.

## Core workflow

Most Discord API integrations use one of these paths:

1. If you already have complete REST payloads, call `createDiscordApiTranscript()`.
2. If you need to fill missing mentions, roles, members, or poll voters, call `createEnrichedDiscordApiTranscript()`.
3. If you want the enriched normalized draft data before compaction, call `buildEnrichedDiscordApiTranscriptData()`.

## Public API

### Message normalization

- `normalizeDiscordApiMessage(message)` converts one `APIMessage` into the draft message format used by `@ticketpm/core`.
- `normalizeDiscordApiMessages(messages)` converts many messages without reordering them.

### Context building

- `buildDiscordApiContext(messages, options)` builds transcript context from the payloads you already have.
- `baseContext` lets you seed `channel_id`, users, channels, roles, members, or guild data before any normalization happens.

### Transcript creation

- `createDiscordApiTranscript(options)` normalizes messages, sorts them oldest-first, builds context, and compacts the result.
- `buildEnrichedDiscordApiTranscriptData(options)` normalizes messages and resolves optional missing context through callbacks, but stops before final compaction.
- `createEnrichedDiscordApiTranscript(options)` performs the full enriched path and returns a compact stored transcript.

## Enricher contract

`BuildEnrichedDiscordApiTranscriptOptions.enricher` accepts optional callbacks:

- `fetchUser(userId)` for user mentions missing from message payloads
- `fetchChannel(channelId)` for mentioned channels and the current channel
- `fetchGuildMember(guildId, userId)` for guild member role membership
- `fetchGuildRoles(guildId)` for role metadata such as name, position, and color
- `fetchPollAnswerVoters({ channelId, messageId, answerId })` for poll voter hydration

You only need to implement the callbacks your export flow actually needs.

## Behavior notes

- `createDiscordApiTranscript()` and `createEnrichedDiscordApiTranscript()` always sort messages chronologically before compact export.
- `buildDiscordApiContext()` preserves existing `baseContext` entries instead of overwriting them with newly normalized values.
- Webhook-like bot authors are normalized the same way as the first-party exporter, including webhook identity flags.
- Mentioned channels are stored using transcript channel types like `text`, `voice`, `thread`, and `stage`.
- When the enricher resolves the current thread channel, the parent channel is fetched as well when `parent_id` is present.
- Guild member role lists are filtered to roles that were actually resolved through `fetchGuildRoles()`.
- Poll answer voters are injected into the normalized draft poll data when `fetchPollAnswerVoters()` returns results.
- If the current transcript channel is still missing at the end, the package falls back to a channel record whose name is the raw channel ID.

## Typical upload flow

This package prepares transcript data. Uploading is still handled by `@ticketpm/core`.

```ts
import { TicketPmUploadClient } from "@ticketpm/core";
import { createEnrichedDiscordApiTranscript } from "@ticketpm/discord-api";

const transcript = await createEnrichedDiscordApiTranscript({
  messages,
  channelId: "123",
  guildId: "456",
  enricher
});

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://api.ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN
});

const result = await uploadClient.uploadTranscript(transcript);
console.log(result.id);
```
