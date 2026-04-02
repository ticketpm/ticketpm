import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
	buildStoredTranscript,
	compressStoredTranscript,
	type DiscordContext,
	type DraftMessage,
	proxyTranscriptAssetsInPlace,
	proxyTranscriptAvatarsInPlace,
	stringifyCanonicalJson,
	TicketPmMediaProxyClient,
	TicketPmUploadClient,
	type TranscriptBuildInput,
	validateTicketPmUploadPayload,
	validateTranscriptUrls,
	validateViewerCompatibility
} from "../src/index.js";

const zstdDecompressAsync = promisify(zstdDecompress);

async function decodeCompressedUploadBody(body: BodyInit | null | undefined) {
	const compressed = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
	const decompressed = await zstdDecompressAsync(Buffer.from(compressed));
	return JSON.parse(new TextDecoder().decode(decompressed));
}

describe("@ticketpm/core", () => {
	it("builds a compact transcript that passes upload validation", () => {
		const transcript = buildStoredTranscript({
			context: {
				channel_id: "123",
				channels: {
					"123": { name: "support" }
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice"
					},
					mentions: [
						{
							id: "u2",
							username: "bob"
						}
					],
					content: "hello"
				}
			]
		});

		expect(transcript.messages[0]).toMatchObject({
			author_id: "u1",
			mention_ids: ["u2"]
		});
		expect(validateTicketPmUploadPayload(transcript).ok).toBe(true);
		expect(validateViewerCompatibility(transcript).ok).toBe(false);
	});

	it("serializes canonically regardless of object insertion order", () => {
		const left = stringifyCanonicalJson({
			z: 1,
			a: {
				y: 2,
				x: 3
			}
		});

		const right = stringifyCanonicalJson({
			a: {
				x: 3,
				y: 2
			},
			z: 1
		});

		expect(left).toBe(right);
		expect(left).toBe('{"a":{"x":3,"y":2},"z":1}');
	});

	it("compresses transcript payloads with zstd", async () => {
		const transcript = buildStoredTranscript({
			context: {
				channel_id: "123",
				channels: {
					"123": { name: "support" }
				},
				users: {
					u1: { id: "u1", username: "alice" }
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice"
					},
					content: "hello"
				}
			]
		});

		const compressed = await compressStoredTranscript(transcript);
		const decompressed = await zstdDecompressAsync(Buffer.from(compressed));

		expect(JSON.parse(new TextDecoder().decode(decompressed))).toEqual(transcript);
	});

	it("reports unsafe transcript media URLs", () => {
		const result = validateTranscriptUrls({
			messages: [
				{
					attachments: [
						{
							url: "https://example.com/file.png"
						}
					]
				}
			]
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.path).toBe("messages[0].attachments[0].url");
		}
	});

	it("passes viewer compatibility when compact references are hydrated by context", () => {
		const transcript = buildStoredTranscript({
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				},
				users: {
					u1: { id: "u1", username: "alice" },
					u2: { id: "u2", username: "bob" },
					u3: { id: "u3", username: "carol" }
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice"
					},
					mentions: [
						{
							id: "u2",
							username: "bob"
						}
					],
					poll: {
						question: { text: "choose" },
						answers: [{ answer_id: 1, poll_media: { text: "a" } }],
						expiry: "2026-03-18T13:00:00.000Z",
						allow_multiselect: false,
						layout_type: 1,
						answer_voters: {
							1: [{ id: "u3", username: "carol" }]
						}
					},
					content: "hello"
				}
			]
		});

		expect(validateViewerCompatibility(transcript)).toEqual({
			ok: true,
			errors: []
		});
	});

	it("uploads avatars without rewriting the stored avatar hash", async () => {
		const fetchCalls: Array<{ url: string; body: string }> = [];
		const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
			fetchCalls.push({
				url: String(input),
				body: String(init?.body ?? "")
			});

			return new Response(JSON.stringify({ hash: "cached-avatar" }), {
				status: 200,
				headers: {
					"Content-Type": "application/json"
				}
			});
		}) as typeof fetch;
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: mockFetch
		});
		const users = {
			u1: {
				id: "u1",
				username: "alice",
				avatar: "a_discordhash"
			}
		};

		await proxyTranscriptAvatarsInPlace(users, client);

		expect(users.u1.avatar).toBe("a_discordhash");
		expect(fetchCalls).toEqual([
			{
				url: "https://m.ticket.pm/v2/avatars/upload",
				body: JSON.stringify({ hash: "a_discordhash", id: "u1" })
			}
		]);
	});

	it("keeps avatar hashes intact when proxying the full transcript asset set", async () => {
		const fetchCalls: string[] = [];
		const mockFetch = (async (input: URL | RequestInfo) => {
			fetchCalls.push(String(input));

			if (String(input).endsWith("/avatars/upload")) {
				return new Response(JSON.stringify({ hash: "cached-avatar" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}

			return new Response(JSON.stringify({ hash: "attachment-hash" }), {
				status: 200,
				headers: {
					"Content-Type": "application/json"
				}
			});
		}) as typeof fetch;
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: mockFetch
		});
		const transcript: { context: DiscordContext; messages: DraftMessage[] } = {
			context: {
				users: {
					u1: {
						id: "u1",
						username: "alice",
						avatar: "discordhash"
					}
				}
			},
			messages: [
				{
					id: "m1",
					content: "hello",
					attachments: [
						{
							id: "a1",
							filename: "file.png",
							size: 1,
							url: "https://cdn.discordapp.com/attachments/1/2/file.png"
						}
					]
				}
			]
		};

		await proxyTranscriptAssetsInPlace(transcript, client);

		expect(transcript.context.users?.u1?.avatar).toBe("discordhash");
		expect(transcript.messages[0]?.attachments?.[0]?.proxy_url).toBe("https://m.ticket.pm/v2/attachments/attachment-hash");
		expect(fetchCalls).toContain("https://m.ticket.pm/v2/avatars/upload");
		expect(fetchCalls).toContain("https://m.ticket.pm/v2/attachments/upload");
	});

	it("auto-creates a default media proxy client for draft uploads", async () => {
		const fetchCalls: Array<{ url: string; headers?: HeadersInit; body?: BodyInit | null }> = [];
		const draftTranscript: TranscriptBuildInput = {
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				},
				users: {
					u1: {
						id: "u1",
						username: "alice",
						avatar: "discordhash"
					}
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice"
					},
					content: "hello",
					attachments: [
						{
							id: "a1",
							filename: "file.png",
							size: 1,
							url: "https://cdn.discordapp.com/attachments/1/2/file.png"
						}
					]
				}
			]
		};
		const uploadClient = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			token: "secret-token",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchCalls.push({
					url: String(input),
					headers: init?.headers,
					body: init?.body
				});

				if (String(input) === "https://m.ticket.pm/v2/avatars/upload") {
					return new Response(JSON.stringify({ hash: "cached-avatar" }), {
						status: 200,
						headers: {
							"Content-Type": "application/json"
						}
					});
				}

				if (String(input) === "https://m.ticket.pm/v2/attachments/upload") {
					return new Response(JSON.stringify({ hash: "attachment-hash" }), {
						status: 200,
						headers: {
							"Content-Type": "application/json"
						}
					});
				}

				return new Response(JSON.stringify({ id: "transcript-id" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});

		const result = await uploadClient.uploadDraftTranscript(draftTranscript);
		const uploadRequest = fetchCalls.find((call) => call.url === "https://ticket.pm/v2/upload?uuid=uuid");
		const uploadedTranscript = await decodeCompressedUploadBody(uploadRequest?.body);
		const avatarRequest = fetchCalls.find((call) => call.url === "https://m.ticket.pm/v2/avatars/upload");
		const attachmentRequest = fetchCalls.find((call) => call.url === "https://m.ticket.pm/v2/attachments/upload");

		expect(result.id).toBe("transcript-id");
		expect(avatarRequest).toBeDefined();
		expect(attachmentRequest).toBeDefined();
		expect(new Headers(avatarRequest?.headers).get("Authorization")).toBe("Bearer secret-token");
		expect(new Headers(attachmentRequest?.headers).get("Authorization")).toBe("Bearer secret-token");
		expect(uploadedTranscript.context.users.u1.avatar).toBe("discordhash");
		expect(uploadedTranscript.messages[0].attachments[0].proxy_url).toBe("https://m.ticket.pm/v2/attachments/attachment-hash");
		expect(draftTranscript.messages[0]?.attachments?.[0]?.proxy_url).toBeUndefined();
	});

	it("allows draft uploads to disable media proxy auto-creation", async () => {
		const fetchCalls: Array<{ url: string; body?: BodyInit | null }> = [];
		const draftTranscript: TranscriptBuildInput = {
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					content: "hello",
					attachments: [
						{
							id: "a1",
							filename: "file.png",
							size: 1,
							url: "https://cdn.discordapp.com/attachments/1/2/file.png"
						}
					]
				}
			]
		};
		const uploadClient = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			token: "secret-token",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchCalls.push({
					url: String(input),
					body: init?.body
				});

				return new Response(JSON.stringify({ id: "transcript-id" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});

		await uploadClient.uploadDraftTranscript(draftTranscript, {
			mediaProxy: false
		});

		const uploadRequest = fetchCalls.find((call) => call.url === "https://ticket.pm/v2/upload?uuid=uuid");
		const uploadedTranscript = await decodeCompressedUploadBody(uploadRequest?.body);

		expect(fetchCalls).toHaveLength(1);
		expect(uploadedTranscript.messages[0].attachments[0].proxy_url).toBeUndefined();
		expect(uploadedTranscript.messages[0].attachments[0].url).toBe("https://cdn.discordapp.com/attachments/1/2/file.png");
	});

	it("uses an explicitly provided media proxy client for draft uploads", async () => {
		const fetchCalls: Array<{ url: string; headers?: HeadersInit; body?: BodyInit | null }> = [];
		const draftTranscript: TranscriptBuildInput = {
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				}
			},
			messages: [
				{
					id: "m1",
					timestamp: "2026-03-18T12:00:00.000Z",
					content: "hello",
					attachments: [
						{
							id: "a1",
							filename: "file.png",
							size: 1,
							url: "https://cdn.discordapp.com/attachments/1/2/file.png"
						}
					]
				}
			]
		};
		const mediaProxy = new TicketPmMediaProxyClient({
			baseUrl: "https://media.example.com/v2",
			token: "proxy-token",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchCalls.push({
					url: String(input),
					headers: init?.headers,
					body: init?.body
				});

				return new Response(JSON.stringify({ hash: "custom-hash" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});
		const uploadClient = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			token: "uploader-token",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchCalls.push({
					url: String(input),
					headers: init?.headers,
					body: init?.body
				});

				return new Response(JSON.stringify({ id: "transcript-id" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});

		await uploadClient.uploadDraftTranscript(draftTranscript, {
			mediaProxy
		});

		const proxyRequest = fetchCalls.find((call) => call.url === "https://media.example.com/v2/attachments/upload");
		const uploadRequest = fetchCalls.find((call) => call.url === "https://ticket.pm/v2/upload?uuid=uuid");
		const uploadedTranscript = await decodeCompressedUploadBody(uploadRequest?.body);

		expect(proxyRequest).toBeDefined();
		expect(new Headers(proxyRequest?.headers).get("Authorization")).toBe("Bearer proxy-token");
		expect(uploadedTranscript.messages[0].attachments[0].proxy_url).toBe("https://media.example.com/v2/attachments/custom-hash");
	});
});
