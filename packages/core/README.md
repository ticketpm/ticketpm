# `@ticketpm/core`

Shared transcript contract for `ticket.pm`.

## What this package owns

- Typed transcript structures used by the upload API and the viewer.
- Deterministic compaction and canonical JSON serialization.
- Upload-contract validation and viewer-compatibility validation.
- ZSTD compression helpers.
- `ticket.pm` transcript upload client.
- `m.ticket.pm` media proxy client plus URL rewriting helpers.

## Runtime support

- Bun is preferred automatically when the package runs on Bun.
- Node.js is also supported for the shared package surface, including ZSTD compression through `node:zlib`.

## Install

```bash
bun add @ticketpm/core
```

```bash
npm install @ticketpm/core
```

## Quick example

```ts
import {
  TicketPmUploadClient,
  type TranscriptBuildInput
} from "@ticketpm/core";

const draftTranscript: TranscriptBuildInput = {
  context: {
    channel_id: "123",
    channels: {
      "123": { name: "support" }
    },
    users: {
      "789": {
        id: "789",
        username: "alice",
        avatar: "a_discord_hash"
      }
    }
  },
  messages: [
    {
      id: "456",
      timestamp: "2026-03-18T12:00:00.000Z",
      author: {
        id: "789",
        username: "alice"
      },
      content: "hello",
      attachments: [
        {
          id: "1",
          filename: "image.png",
          size: 123,
          url: "https://cdn.discordapp.com/attachments/1/2/image.png"
        }
      ]
    }
  ]
};

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN
});

const result = await uploadClient.uploadDraftTranscript(draftTranscript);
console.log(result.id);
```

`uploadDraftTranscript()` auto-creates a `TicketPmMediaProxyClient` when you do
not pass one explicitly. The default auto-created client uses:

- base URL: `https://m.ticket.pm/v2`
- token: the same token configured on `TicketPmUploadClient`
- fetch: the same fetch implementation configured on `TicketPmUploadClient`

## Quick example with a custom media proxy

If you want a different media proxy base URL or token, pass a custom client.

```ts
import {
  TicketPmMediaProxyClient,
  TicketPmUploadClient,
  type TranscriptBuildInput
} from "@ticketpm/core";

const draftTranscript: TranscriptBuildInput = {
  context: {
    channel_id: "123",
    channels: {
      "123": { name: "support" }
    },
    users: {
      "789": {
        id: "789",
        username: "alice",
        avatar: "a_discord_hash"
      }
    }
  },
  messages: [
    {
      id: "456",
      timestamp: "2026-03-18T12:00:00.000Z",
      author: {
        id: "789",
        username: "alice",
        avatar: "a_discord_hash"
      },
      content: "hello",
      attachments: [
        {
          id: "1",
          filename: "image.png",
          size: 123,
          url: "https://cdn.discordapp.com/attachments/1/2/image.png"
        }
      ]
    }
  ]
};

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN
});

const mediaProxy = new TicketPmMediaProxyClient({
  baseUrl: "https://media.example.com/v2",
  token: process.env.MEDIA_PROXY_TOKEN
});

const result = await uploadClient.uploadDraftTranscript(draftTranscript, {
  mediaProxy
});
console.log(result.id);
```

## Quick example without any media proxy

If you want to skip attachment, avatar, and guild icon proxying entirely, turn
it off for the upload call.

```ts
import {
  TicketPmUploadClient,
  type TranscriptBuildInput
} from "@ticketpm/core";

const draftTranscript: TranscriptBuildInput = {
  context: {
    channel_id: "123",
    channels: {
      "123": { name: "support" }
    }
  },
  messages: [
    {
      id: "456",
      timestamp: "2026-03-18T12:00:00.000Z",
      content: "hello",
      attachments: [
        {
          id: "1",
          filename: "image.png",
          size: 123,
          url: "https://cdn.discordapp.com/attachments/1/2/image.png"
        }
      ]
    }
  ]
};

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN
});

const result = await uploadClient.uploadDraftTranscript(draftTranscript, {
  mediaProxy: false
});
console.log(result.id);
```

In this mode, the original transcript media fields are uploaded as-is and no
media proxy calls are made.

## Core workflow

Most integrations follow this order:

1. Normalize source messages into the draft transcript shape.
2. Optionally proxy media and avatar assets.
   `uploadDraftTranscript()` does this automatically unless you set `mediaProxy: false`.
3. Build the compact stored transcript with `buildStoredTranscript()`.
4. Optionally validate it with `validateTicketPmUploadPayload()` and `validateViewerCompatibility()`.
5. Compress it with `compressStoredTranscript()`.
6. Upload it with `TicketPmUploadClient`.

## Public API

### Transcript building

- `buildStoredTranscript(input)` compacts a draft transcript into the viewer/upload format expected by `ticket.pm`.
- `sortMessagesChronologically(messages)` sorts newest-first collections into stable oldest-first order.
- `pruneForExport(value)` removes empty structures and nullish values using the same rules as the compact export path.

### Validation

- `validateTicketPmUploadPayload(transcript)` checks the hard upload contract.
- `validateViewerCompatibility(transcript)` checks the softer viewer hydration contract.
- `validateTranscriptUrls(payload)` walks transcript-like payloads and validates media/link safety.

### Serialization and compression

- `stringifyCanonicalJson(value)` sorts object keys deterministically.
- `serializeStoredTranscript(transcript)` converts a stored transcript into upload-ready JSON bytes.
- `compressBytesZstd(bytes, options)` compresses arbitrary bytes.
- `compressStoredTranscript(transcript, options)` canonicalizes and compresses in one step.

### Uploading

- `TicketPmUploadClient` uploads compressed transcript bytes or full transcripts to `POST /upload`.
- `TicketPmUploadClient.uploadDraftTranscript()` proxies draft assets, builds the stored transcript, compresses it, and uploads it in one step.
- `TicketPmMediaProxyClient` uploads avatar hashes, guild icon hashes, and attachment/media URLs to a media proxy.

## Media proxy configuration

To use a custom media proxy, set `baseUrl` when constructing `TicketPmMediaProxyClient`.

```ts
const mediaProxy = new TicketPmMediaProxyClient({
  baseUrl: "https://media.example.com/v2",
  token: process.env.MEDIA_PROXY_TOKEN
});
```

Behavior notes:

- `baseUrl` is the root used for both upload endpoints and generated proxy URLs.
- `uploadAvatarHash()` calls `POST {baseUrl}/avatars/upload`.
- `uploadGuildIconHash()` calls `POST {baseUrl}/icons/upload`.
- `uploadAttachmentUrl()` calls `POST {baseUrl}/attachments/upload`.
- Successful attachment uploads produce `{baseUrl}/attachments/{hash}`.
- Successful avatar and icon uploads produce `{baseUrl}/avatars/{hash}` and `{baseUrl}/icons/{hash}` URLs.

## Failure behavior and fallbacks

This package is intentionally conservative when the media proxy is unavailable.

### Attachment and embed media

When `rewriteTranscriptMediaUrlsInPlace()` or `proxyTranscriptAssetsInPlace()` tries to proxy media URLs:

- If the media proxy request succeeds and returns a valid hash, `proxy_url` or `proxy_icon_url` is written.
- If the proxy request fails, returns a non-2xx response, or returns an invalid payload, nothing is overwritten.
- The original Discord `url`, existing `proxy_url`, `icon_url`, or `proxy_icon_url` is kept as-is.

If the media proxy is down, the package falls back by not replacing the transcript field, so Discord-hosted media URLs remain in the payload.

### Avatars

`proxyTranscriptAvatarsInPlace()` uploads avatar hashes only as a cache/warm-up side effect.

- `user.avatar` is never replaced with a proxy URL.
- If avatar upload fails, the transcript is unchanged.
- This is required because the current viewer still expects `user.avatar` to be the original Discord avatar hash.

### Guild icons

`proxyGuildIconInPlace()` behaves differently from user avatars:

- `guild.icon` remains the original hash.
- `guild.proxy_icon_url` is set only on successful proxy upload.
- If the upload fails, `guild.proxy_icon_url` is left unchanged.

### No automatic retries

The core package does not implement retry/backoff logic for media or transcript uploads. If your environment needs retries, wrap the provided clients with your own retry policy.

## Runtime selection for compression

Compression helpers prefer Bun automatically, but you can also force a specific runtime path:

```ts
await compressBytesZstd(bytes, { runtime: "auto" });
await compressBytesZstd(bytes, { runtime: "bun" });
await compressBytesZstd(bytes, { runtime: "node" });
```

Behavior notes:

- `runtime: "auto"` prefers Bun and falls back to Node.
- `runtime: "bun"` throws if Bun is not available.
- `runtime: "node"` uses the Node fallback even when running on Bun.

## Upload client configuration

`TicketPmUploadClient` accepts:

- `baseUrl`: transcript API root such as `https://ticket.pm/v2`
- `token`: optional bearer token or raw token string
- `fetch`: optional custom fetch implementation
- `defaultMediaProxyBaseUrl`: optional override for the auto-created media proxy client used by `uploadDraftTranscript()`

Example:

```ts
const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://ticket.pm/v2",
  token: process.env.TICKETPM_TOKEN,
  fetch: customFetch,
  defaultMediaProxyBaseUrl: "https://m.ticket.pm/v2"
});
```

Important:

- `uploadCompressedTranscript()` and `uploadTranscript()` do not touch media proxying because they operate on already-built data.
- `uploadDraftTranscript()` auto-creates a `TicketPmMediaProxyClient` when `mediaProxy` is omitted.
- The auto-created media proxy client inherits the uploader token and fetch implementation.
- The auto-created media proxy client defaults to `https://m.ticket.pm/v2`, unless `defaultMediaProxyBaseUrl` overrides it.
- If you pass an explicit `TicketPmMediaProxyClient`, that client is used as-is instead of the auto-created one.
- If you pass `mediaProxy: false`, media proxying is disabled for that upload.

Example:

```ts
const token = process.env.TICKETPM_TOKEN;

const uploadClient = new TicketPmUploadClient({
  baseUrl: "https://ticket.pm/v2",
  token
});

await uploadClient.uploadDraftTranscript(draftTranscript);
```

## Media proxy client configuration

`TicketPmMediaProxyClient` accepts:

- `baseUrl`: media API root such as `https://m.ticket.pm/v2`
- `token`: optional bearer token or raw token string
- `fetch`: optional custom fetch implementation

## Important compatibility notes

- `context.channel_id` and `context.channels[context.channel_id].name` are required for upload compatibility.
- Canonical JSON ordering matters because server-side dedupe hashes decompressed bytes, not semantic JSON.
- Viewer compatibility is stricter than upload acceptance. A payload can upload successfully and still hydrate poorly if compact IDs are missing corresponding context entries.
- `user.avatar` should stay a Discord avatar hash, not a proxy URL.
