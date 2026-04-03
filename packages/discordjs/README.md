# `@ticketpm/discordjs`

Adapters for converting `discord.js` objects into `ticket.pm` transcript payloads.

## What this package adds

- Conversion from `Message`, `User`, `GuildMember`, `Role`, and channel-like objects into `@ticketpm/core` data structures.
- Context builders for transcripts assembled from already-fetched discord.js objects.
- A pagination helper for walking backwards through channel history before export.
- One-shot helpers that normalize, sort, compact, and finalize transcripts.

## Install

```bash
bun add @ticketpm/discordjs
```

```bash
npm install @ticketpm/discordjs discord.js
```

`discord.js` is a peer dependency and must exist in your application.

## When to use this package

Use `@ticketpm/discordjs` when your bot or export worker has live `discord.js` objects in memory and you do not want to translate them into raw REST payloads first.

If your integration works directly with Discord REST payloads, such as gateway event payloads or REST API responses, use `@ticketpm/discord-api` instead.

## Quick example

```ts
import { createDiscordJsTranscript, fetchMessagesUpToLimit } from "@ticketpm/discordjs";

const messages = await fetchMessagesUpToLimit(channel, 1000);

const transcript = createDiscordJsTranscript({
  messages,
  channel: {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null
  },
  guild: channel.guild
});
```

`fetchMessagesUpToLimit()` pages backward through channel history. `createDiscordJsTranscript()` then sorts the normalized messages chronologically before compact export.

## Build from already-fetched objects

If you already have the messages, roles, members, and channel metadata you want, you can pass them directly and skip extra Discord fetches in your own code.

```ts
import { buildDiscordJsContext, createDiscordJsTranscript } from "@ticketpm/discordjs";

const context = buildDiscordJsContext(messages, {
  channel: {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null
  },
  parentChannel: parent
    ? {
        id: parent.id,
        name: parent.name,
        type: parent.type,
        parentId: parent.parentId ?? null
      }
    : undefined,
  guild,
  roles: guild.roles.cache.values(),
  members: guild.members.cache.values()
});

const transcript = createDiscordJsTranscript({
  messages,
  baseContext: context,
  channel: {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null
  }
});
```

## Public API

### Object conversion helpers

- `discordJsUserToUserInfo(user)` converts a `discord.js` user into transcript user data.
- `discordJsRoleToRoleInfo(role)` converts a role into transcript role metadata.
- `discordJsMemberToMemberInfo(member)` converts a guild member into transcript member role data.
- `discordJsChannelToChannelInfo(channel)` converts a channel-like object into transcript channel metadata.
- `discordJsMessageToDraftMessage(message)` converts one `discord.js` message into the draft message format used by `@ticketpm/core`.

### Context and transcript creation

- `buildDiscordJsContext(messages, options)` builds transcript context from already-fetched discord.js objects.
- `createDiscordJsTranscript(options)` normalizes messages, sorts them oldest-first, builds context, and compacts the final transcript.

### Message collection

- `fetchMessagesUpToLimit(channel, maxMessages, pageSize)` pages backward through `channel.messages.fetch()` until it reaches the requested limit or no more messages remain.

## Behavior notes

- `createDiscordJsTranscript()` always sorts messages chronologically before compact export.
- `fetchMessagesUpToLimit()` returns the messages in the order they were fetched from Discord history, which is typically newest-first. The transcript helper reorders them for final export.
- `buildDiscordJsContext()` keeps pre-seeded `baseContext` entries and fills only missing users, channels, roles, members, or guild metadata.
- Member role lists are filtered so only roles that actually exist in the transcript context remain attached to members.
- Passing `guild` adds guild metadata such as `name`, `icon`, `icon_url`, `approximate_member_count`, `owner_id`, and `vanity_url_code`.
- Passing `channel` and `parentChannel` lets the transcript preserve thread and parent-channel relationships.
- Message references, attachments, embeds, reactions, components, stickers, and polls are all normalized from the discord.js message object when present.
- Webhook-backed messages are normalized with webhook-aware author formatting to stay consistent with the main exporter.

## Pagination details

`fetchMessagesUpToLimit()` is intentionally small and predictable:

- It requests pages through `channel.messages.fetch({ limit, before })`.
- It stops when Discord returns an empty page.
- It also stops when Discord returns a partial page smaller than the requested page size for the remaining history window.
- Errors from `channel.messages.fetch()` are not swallowed; they propagate to the caller unchanged.

## Typical upload flow

This package prepares transcript data. Uploading is still handled by `@ticketpm/core`.

```ts
import { TicketPmUploadClient } from "@ticketpm/core";
import { createDiscordJsTranscript, fetchMessagesUpToLimit } from "@ticketpm/discordjs";

const messages = await fetchMessagesUpToLimit(channel, 1000);

const transcript = createDiscordJsTranscript({
  messages,
  channel: {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null
  },
  guild: channel.guild
});

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://api.ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN
});

const result = await uploadClient.uploadTranscript(transcript);
console.log(result.id);
```
