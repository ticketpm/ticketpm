import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildStoredTranscript,
	ComponentType,
	compressStoredTranscript,
	collectTranscriptMediaUrls,
	type DiscordContext,
	type DraftMessage,
	MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS,
	MAX_TRANSCRIPT_COMPRESSED_BYTES,
	MAX_TRANSCRIPT_NESTING_DEPTH,
	proxyGuildIconInPlace,
	proxyTranscriptAssetsInPlace,
	proxyTranscriptAvatarsInPlace,
	rewriteTranscriptMediaUrlsInPlace,
	stringifyCanonicalJson,
	TicketPmMediaProxyClient,
	TicketPmUploadClient,
	type StoredTranscript,
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

afterEach(() => {
	vi.unstubAllGlobals();
});

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

	it("prunes empty context containers while preserving the active channel", () => {
		const transcript = buildStoredTranscript({
			context: {
				channel_id: "c1",
				channels: {},
				roles: {},
				members: {}
			},
			messages: [
				{
					id: "m1",
					content: "hello"
				}
			]
		});

		expect(transcript).toEqual({
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "c1" }
				}
			},
			messages: [{ content: "hello", id: "m1" }]
		});
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

	it("accepts safe proxy media URLs even when the original media URL is unsafe", () => {
		const result = validateTranscriptUrls({
			messages: [
				{
					attachments: [
						{
							url: "https://example.com/file.png",
							proxy_url: "https://m.ticket.pm/v2/attachments/file"
						}
					],
					embeds: [
						{
							author: {
								name: "ticket.pm",
								icon_url: "https://example.com/icon.png",
								proxy_icon_url: "https://m.ticket.pm/v2/attachments/icon"
							},
							image: {
								url: "https://example.com/image.png",
								proxy_url: "https://m.ticket.pm/v2/attachments/image",
								width: 1
							}
						}
					],
					components: [
						{
							type: ComponentType.File,
							file: {
								url: "https://downloads.example.com/file.txt",
								proxy_url: "https://m.ticket.pm/v2/attachments/component-file",
								size: 1
							}
						}
					]
				}
			]
		});

		expect(result.ok).toBe(true);
	});

	it("walks nested snapshots when validating transcript URLs", () => {
		const result = validateTranscriptUrls({
			messages: [
				{
					message_snapshots: [
						{
							message: {
								attachments: [
									{
										url: "https://example.com/file.png"
									}
								]
							}
						}
					]
				}
			]
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.path).toBe("messages[0].message_snapshots[0].message.attachments[0].url");
		}
	});

	it("rejects transcript payloads that exceed the maximum nesting depth", () => {
		let payload: unknown = [];
		for (let depth = 0; depth <= MAX_TRANSCRIPT_NESTING_DEPTH; depth += 1) {
			payload = [payload];
		}

		const result = validateTranscriptUrls(payload);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain(String(MAX_TRANSCRIPT_NESTING_DEPTH));
		}
	});

	it("accepts transcript payloads at the maximum nesting depth", () => {
		let payload: unknown = [];
		for (let depth = 0; depth < MAX_TRANSCRIPT_NESTING_DEPTH; depth += 1) {
			payload = [payload];
		}

		expect(validateTranscriptUrls(payload)).toEqual({ ok: true });
	});

	it("reports upload validation errors for missing channels and oversized names", () => {
		const missingChannel = validateTicketPmUploadPayload({
			messages: []
		});
		const longName = "x".repeat(MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS + 1);
		const oversizedChannel = validateTicketPmUploadPayload({
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: longName }
				}
			},
			messages: []
		});

		expect(missingChannel).toEqual({
			ok: false,
			errors: [
				{
					path: "context.channel_id",
					message:
						"Invalid transcript context: either context.channel_id is missing, context.channels[context.channel_id] is missing, or context.channels[context.channel_id].name is missing"
				}
			]
		});
		expect(oversizedChannel).toEqual({
			ok: false,
			errors: [
				{
					path: "context.channel_id",
					message:
						"Invalid transcript context: context.channels[context.channel_id].name must be less or equal to 100 characters"
				}
			]
		});
	});

	it("accepts channel names at the maximum allowed length", () => {
		const result = validateTicketPmUploadPayload({
			context: {
				channel_id: "c1",
				channels: {
					c1: {
						name: "x".repeat(MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS)
					}
				}
			},
			messages: []
		});

		expect(result).toEqual({
			ok: true,
			errors: []
		});
	});

	it("reports hydration gaps for nested interaction metadata, references, and poll voters", () => {
		const transcript: StoredTranscript = {
			context: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				},
				users: {
					u1: { id: "u1", username: "alice" }
				}
			},
			messages: [
				{
					id: "m1",
					author_id: "u1",
					interaction_metadata: {
						id: "i1",
						type: 2,
						user_id: "u2",
						triggering_interaction_metadata: {
							id: "i2",
							type: 2,
							user_id: "u3"
						}
					},
					referenced_message: {
						id: "ref1",
						author_id: "u4"
					},
					poll: {
						question: { text: "choose" },
						answers: [{ answer_id: 1, poll_media: { text: "a" } }],
						expiry: "2026-03-18T13:00:00.000Z",
						allow_multiselect: false,
						layout_type: 1,
						answer_voter_ids: {
							1: ["u5"]
						}
					}
				}
			]
		};

		expect(validateViewerCompatibility(transcript)).toEqual({
			ok: false,
			errors: [
				{
					path: "messages[0].interaction_metadata.user_id",
					message: "interaction user cannot be hydrated from context.users"
				},
				{
					path: "messages[0].interaction_metadata.triggering_interaction_metadata.user_id",
					message: "interaction user cannot be hydrated from context.users"
				},
				{
					path: "messages[0].referenced_message.author_id",
					message: "referenced author cannot be hydrated from context.users"
				},
				{
					path: "messages[0].poll.answer_voter_ids.1[0]",
					message: "poll voter cannot be hydrated from context.users"
				}
			]
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

	it("deduplicates avatar uploads while still reporting progress for each valid user", async () => {
		const fetchCalls: Array<{ url: string; body: string }> = [];
		const progressUpdates: Array<[number, number]> = [];
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
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
			}) as typeof fetch
		});
		const users = {
			u1: { id: "u1", username: "alice", avatar: "same_hash" },
			u2: { id: "u2", username: "bob", avatar: " same_hash " },
			u3: { id: "u3", username: "carol", avatar: "" }
		};

		await proxyTranscriptAvatarsInPlace(users, client, {
			onProgress: (completed, total) => {
				progressUpdates.push([completed, total]);
			}
		});

		expect(fetchCalls).toEqual([
			{
				url: "https://m.ticket.pm/v2/avatars/upload",
				body: JSON.stringify({ hash: "same_hash", id: "u1" })
			}
		]);
		expect(progressUpdates).toEqual([
			[0, 2],
			[1, 2],
			[2, 2]
		]);
	});

	it("continues avatar proxy uploads after a non-2xx media proxy response", async () => {
		const fetchCalls: string[] = [];
		const progressUpdates: Array<[number, number]> = [];
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				const body = JSON.parse(String(init?.body ?? "{}")) as { hash?: string };
				fetchCalls.push(body.hash ?? "");

				return body.hash === "hash3"
					? new Response("proxy unavailable", { status: 503 })
					: new Response(JSON.stringify({ hash: `cached-${body.hash}` }), {
							status: 200,
							headers: {
								"Content-Type": "application/json"
							}
						});
			}) as typeof fetch
		});
		const users = Object.fromEntries(
			Array.from({ length: 5 }, (_, index) => {
				const id = `u${index + 1}`;
				return [
					id,
					{
						id,
						username: `user-${index + 1}`,
						avatar: `hash${index + 1}`
					}
				];
			})
		);

		await proxyTranscriptAvatarsInPlace(users, client, {
			onProgress: (completed, total) => {
				progressUpdates.push([completed, total]);
			}
		});

		expect(fetchCalls).toEqual(["hash1", "hash2", "hash3", "hash4", "hash5"]);
		expect(progressUpdates[progressUpdates.length - 1]).toEqual([5, 5]);
		expect(Object.values(users).map((user) => user.avatar)).toEqual(["hash1", "hash2", "hash3", "hash4", "hash5"]);
	});

	it("propagates hard network failures during avatar proxy uploads", async () => {
		const fetchCalls: string[] = [];
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				const body = JSON.parse(String(init?.body ?? "{}")) as { hash?: string };
				fetchCalls.push(body.hash ?? "");

				if (body.hash === "hash2") {
					throw new TypeError("fetch failed");
				}

				return new Response(JSON.stringify({ hash: `cached-${body.hash}` }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});

		await expect(
			proxyTranscriptAvatarsInPlace(
				{
					u1: { id: "u1", username: "alice", avatar: "hash1" },
					u2: { id: "u2", username: "bob", avatar: "hash2" },
					u3: { id: "u3", username: "carol", avatar: "hash3" }
				},
				client
			)
		).rejects.toThrow("fetch failed");
		expect(fetchCalls).toEqual(["hash1", "hash2"]);
	});

	it("collects unique media URLs and skips invalid ones", () => {
		const urls = collectTranscriptMediaUrls([
			{
				id: "m1",
				attachments: [
					{
						id: "a1",
						filename: "file.png",
						size: 1,
						url: "https://cdn.discordapp.com/attachments/1/2/file.png"
					},
					{
						id: "a2",
						filename: "file-again.png",
						size: 1,
						url: "https://cdn.discordapp.com/attachments/1/2/file.png"
					}
				],
				embeds: [
					{
						author: {
							name: "bot",
							icon_url: "https://cdn.discordapp.com/embed-icons/1.png"
						},
						image: {
							url: "not-a-url",
							width: 1
						}
					}
				]
			}
		]);

		expect([...urls]).toEqual([
			"https://cdn.discordapp.com/attachments/1/2/file.png",
			"https://cdn.discordapp.com/embed-icons/1.png"
		]);
	});

	it("rewrites only non-proxied media URLs in place", async () => {
		const fetchBodies: string[] = [];
		let uploadIndex = 0;
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchBodies.push(String(init?.body ?? ""));
				uploadIndex += 1;

				return new Response(JSON.stringify({ hash: `hash-${uploadIndex}` }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});
		const messages: DraftMessage[] = [
			{
				id: "m1",
				attachments: [
					{
						id: "a1",
						filename: "fresh.png",
						size: 1,
						url: "https://cdn.discordapp.com/attachments/1/2/fresh.png"
					},
					{
						id: "a2",
						filename: "cached.png",
						size: 1,
						url: "https://cdn.discordapp.com/attachments/1/2/cached.png",
						proxy_url: "https://m.ticket.pm/v2/attachments/existing"
					}
				],
				embeds: [
					{
						author: {
							name: "bot",
							icon_url: "https://cdn.discordapp.com/embed-icons/1.png"
						}
					}
				]
			}
		];

		await rewriteTranscriptMediaUrlsInPlace(messages, client);

		expect(fetchBodies).toEqual([
			JSON.stringify({ url: "https://cdn.discordapp.com/attachments/1/2/fresh.png" }),
			JSON.stringify({ url: "https://cdn.discordapp.com/embed-icons/1.png" })
		]);
		expect(messages[0]?.attachments?.[0]?.proxy_url).toBe("https://m.ticket.pm/v2/attachments/hash-1");
		expect(messages[0]?.attachments?.[1]?.proxy_url).toBe("https://m.ticket.pm/v2/attachments/existing");
		expect(messages[0]?.embeds?.[0]?.author?.proxy_icon_url).toBe("https://m.ticket.pm/v2/attachments/hash-2");
	});

	it("propagates hard network failures during media rewrites", async () => {
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch
		});

		await expect(
			rewriteTranscriptMediaUrlsInPlace(
				[
					{
						id: "m1",
						attachments: [
							{
								id: "a1",
								filename: "file.png",
								size: 1,
								url: "https://cdn.discordapp.com/attachments/1/2/file.png"
							}
						]
					}
				],
				client
			)
		).rejects.toThrow("fetch failed");
	});

	it("proxies guild icons with the animated flag when the source hash is animated", async () => {
		const fetchCalls: string[] = [];
		const client = new TicketPmMediaProxyClient({
			baseUrl: "https://m.ticket.pm/v2",
			fetch: (async (input: URL | RequestInfo) => {
				fetchCalls.push(String(input));

				return new Response(JSON.stringify({ hash: "guild-icon" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				});
			}) as typeof fetch
		});
		const guild: DiscordContext["guild"] = {
			id: "g1",
			name: "Guild",
			icon: "a_originalhash"
		};

		await proxyGuildIconInPlace(guild!, client);

		expect(fetchCalls).toEqual(["https://m.ticket.pm/v2/icons/upload"]);
		expect(guild?.proxy_icon_url).toBe("https://m.ticket.pm/v2/icons/guild-icon?animated=true");
	});

	it("rejects compressed uploads that exceed the configured size limit", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const client = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: fetchMock
		});

		await expect(client.uploadCompressedTranscript(new Uint8Array(MAX_TRANSCRIPT_COMPRESSED_BYTES + 1))).rejects.toThrow(
			`Compressed transcript exceeds ${MAX_TRANSCRIPT_COMPRESSED_BYTES} bytes.`
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("accepts compressed uploads at the configured size limit", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ id: "transcript-id" }), {
				status: 200,
				headers: {
					"Content-Type": "application/json"
				}
			})
		);
		const client = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: fetchMock
		});

		const result = await client.uploadCompressedTranscript(new Uint8Array(MAX_TRANSCRIPT_COMPRESSED_BYTES));

		expect(result.id).toBe("transcript-id");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("supports uploads without uuid-style ids and returns rate limit headers", async () => {
		const fetchCalls: Array<{ url: string; headers?: HeadersInit }> = [];
		const client = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			token: "Bearer already-normalized",
			fetch: (async (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
				fetchCalls.push({
					url: String(input),
					headers: init?.headers
				});

				return new Response(JSON.stringify({ id: "transcript-id" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"X-RateLimit-Remaining": "4",
						"X-RateLimit-Reset": "123.5"
					}
				});
			}) as typeof fetch
		});

		const result = await client.uploadCompressedTranscript(new Uint8Array([1, 2, 3]), {
			uuidStyleIds: false
		});

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0]?.url).toBe("https://ticket.pm/v2/upload");
		expect(new Headers(fetchCalls[0]?.headers).get("Authorization")).toBe("Bearer already-normalized");
		expect(result).toEqual({
			id: "transcript-id",
			rateLimitRemaining: 4,
			rateLimitReset: 123.5
		});
	});

	it("ignores malformed or missing rate limit headers", async () => {
		const client = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: (async () =>
				new Response(JSON.stringify({ id: "transcript-id" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"X-RateLimit-Remaining": "not-a-number"
					}
				})) as unknown as typeof fetch
		});

		await expect(client.uploadCompressedTranscript(new Uint8Array([1, 2, 3]))).resolves.toEqual({
			id: "transcript-id",
			rateLimitRemaining: undefined,
			rateLimitReset: undefined
		});
	});

	it("surfaces upload API errors and missing transcript ids", async () => {
		const failingClient = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: (async () =>
				new Response("upload failed", {
					status: 500
				})) as unknown as typeof fetch
		});
		const missingIdClient = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: (async () =>
				new Response(JSON.stringify({}), {
					status: 200,
					headers: {
						"Content-Type": "application/json"
					}
				})) as unknown as typeof fetch
		});

		await expect(failingClient.uploadCompressedTranscript(new Uint8Array([1]))).rejects.toThrow("upload failed");
		await expect(missingIdClient.uploadCompressedTranscript(new Uint8Array([1]))).rejects.toThrow(
			"ticket.pm upload completed without returning a transcript id."
		);
	});

	it("propagates hard network failures from transcript uploads", async () => {
		const client = new TicketPmUploadClient({
			baseUrl: "https://ticket.pm/v2",
			fetch: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch
		});

		await expect(client.uploadCompressedTranscript(new Uint8Array([1]))).rejects.toThrow("fetch failed");
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

	it("falls back to JSON cloning when structuredClone is unavailable", async () => {
		vi.stubGlobal("structuredClone", undefined);

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

		await uploadClient.uploadDraftTranscript(draftTranscript);

		const uploadRequest = fetchCalls.find((call) => call.url === "https://ticket.pm/v2/upload?uuid=uuid");
		const uploadedTranscript = await decodeCompressedUploadBody(uploadRequest?.body);

		expect(draftTranscript.messages[0]?.attachments?.[0]?.proxy_url).toBeUndefined();
		expect(uploadedTranscript.messages[0].attachments[0].proxy_url).toBe("https://m.ticket.pm/v2/attachments/attachment-hash");
	});
});
