# `@ticketpm/discordjs`

Adapters for converting `discord.js` objects into `ticket.pm` transcript payloads.

## What this package adds

- Conversion from `Message`, `User`, `GuildMember`, `Role`, and channel-like objects into `@ticketpm/core` data structures.
- Context builders for transcripts assembled from already-fetched discord.js objects.
- Draft transcript creation for media-proxied uploads through `@ticketpm/core`.
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

If you already have the messages, roles, members, and channel metadata you want, you can pass them directly and skip extra Discord fetches in your own code. Member data is used only to attach role metadata to transcript participants.

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
- `createDiscordJsDraftTranscript(options)` normalizes messages, sorts them oldest-first, and returns the draft transcript shape expected by `TicketPmUploadClient.uploadDraftTranscript()`.
- `createDiscordJsTranscript(options)` normalizes messages, sorts them oldest-first, builds context, and compacts the final transcript.

### Message collection

- `fetchMessagesUpToLimit(channel, maxMessages, pageSize)` pages backward through `channel.messages.fetch()` until it reaches the requested limit or no more messages remain.

## Behavior notes

- `createDiscordJsTranscript()` always sorts messages chronologically before compact export.
- `createDiscordJsDraftTranscript()` is the right helper when you want `@ticketpm/core` to proxy avatars, attachments, embed media, and guild icons through `https://m.ticket.pm/v2` during upload.
- `fetchMessagesUpToLimit()` returns the messages in the order they were fetched from Discord history, which is typically newest-first. The transcript helper reorders them for final export.
- `buildDiscordJsContext()` keeps pre-seeded `baseContext` entries and fills missing users from transcript messages, mentions, and references.
- Member role lists are attached only for users already present in the transcript context, and only for roles that exist in the context.
- Passing `guild` adds guild metadata such as `name`, `icon`, `icon_url`, `approximate_member_count`, `owner_id`, and `vanity_url_code`, and can provide cached member roles for transcript participants.
- Passing `channel` and `parentChannel` lets the transcript preserve thread and parent-channel relationships.
- Message references, attachments, embeds, reactions, components, stickers, and polls are all normalized from the discord.js message object when present.
- Messages with `webhookId` are normalized as webhooks unless they contain interaction metadata. This preserves application-owned channel webhooks while keeping interaction responses classified as app messages.
- Per-message webhook username and avatar overrides are preserved through core compaction. The most common identity stays in shared context so persistent renames do not duplicate author data across every message.

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
import { createDiscordJsDraftTranscript, fetchMessagesUpToLimit } from "@ticketpm/discordjs";

const messages = await fetchMessagesUpToLimit(channel, 1000);

const draftTranscript = createDiscordJsDraftTranscript({
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

const result = await uploadClient.uploadDraftTranscript(draftTranscript);
console.log(result.id);
```

`uploadDraftTranscript()` is the important part here. It auto-proxies supported
assets to `https://m.ticket.pm/v2` by default before the final transcript is
compacted and uploaded, including:

- user avatar hashes
- guild icon hashes
- attachments
- embed image, thumbnail, video, author icon, and footer icon URLs
