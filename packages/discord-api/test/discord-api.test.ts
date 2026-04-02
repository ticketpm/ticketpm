import { describe, expect, it } from "vitest";

import { buildEnrichedDiscordApiTranscriptData, createDiscordApiTranscript, normalizeDiscordApiMessage } from "../src/index.js";

describe("@ticketpm/discord-api", () => {
	it("normalizes webhook-like bot usernames for transcript export", () => {
		const message = normalizeDiscordApiMessage({
			id: "m1",
			channel_id: "c1",
			content: "hello",
			timestamp: "2026-03-18T12:00:00.000Z",
			author: {
				id: "u1",
				username: "relay",
				discriminator: "1234",
				avatar: null,
				bot: true
			},
			application_id: null,
			webhook_id: "wh1",
			mentions: [],
			attachments: [],
			embeds: []
		} as never);

		expect(message.author?.username).toBe("relay#1234");
		expect(message.author?.display_name).toBe("relay");
		expect(message.author?.webhook).toBe(true);
	});

	it("creates a compact transcript from raw API payloads", () => {
		const transcript = createDiscordApiTranscript({
			messages: [
				{
					id: "m1",
					channel_id: "c1",
					content: "hello",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: []
				} as never
			],
			baseContext: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				}
			}
		});

		expect(transcript.messages[0]).toMatchObject({
			id: "m1",
			author_id: "u1",
			content: "hello"
		});
		expect(transcript.context?.channels?.c1?.name).toBe("support");
	});

	it("enriches missing users and poll voters through callbacks", async () => {
		const data = await buildEnrichedDiscordApiTranscriptData({
			channelId: "c1",
			guildId: "g1",
			messages: [
				{
					id: "m1",
					channel_id: "c1",
					content: "hi <@2>",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: [],
					mention_roles: ["r1"],
					poll: {
						question: { text: "choose" },
						answers: [{ answer_id: 1, poll_media: { text: "a" } }],
						expiry: "2026-03-18T13:00:00.000Z",
						allow_multiselect: false,
						layout_type: 1
					}
				} as never
			],
			enricher: {
				fetchUser: async (userId) =>
					({
						id: userId,
						username: "bob",
						avatar: null
					}) as never,
				fetchChannel: async (channelId) =>
					({
						id: channelId,
						type: 0,
						name: "support"
					}) as never,
				fetchGuildMember: async () =>
					({
						roles: ["r1"]
					}) as never,
				fetchGuildRoles: async () => [
					{
						id: "r1",
						name: "Support",
						position: 1,
						color: 0xff0000
					} as never
				],
				fetchPollAnswerVoters: async () => [
					{
						id: "u3",
						username: "carol",
						avatar: null
					} as never
				]
			}
		});

		expect(data.context.users?.["2"]?.username).toBe("bob");
		expect(data.context.roles?.r1?.color).toBe("#ff0000");
		expect(data.messages[0]?.poll?.answer_voters?.[1]?.[0]?.id).toBe("u3");
	});

	it("sorts messages chronologically before compact export", () => {
		const transcript = createDiscordApiTranscript({
			messages: [
				{
					id: "m2",
					channel_id: "c1",
					content: "later",
					timestamp: "2026-03-18T12:05:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: []
				} as never,
				{
					id: "m1",
					channel_id: "c1",
					content: "earlier",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: []
				} as never
			],
			baseContext: {
				channel_id: "c1",
				channels: {
					c1: { name: "support" }
				}
			}
		});

		expect(transcript.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
	});

	it("adds the current channel to context when fetched through the enricher", async () => {
		const data = await buildEnrichedDiscordApiTranscriptData({
			channelId: "thread1",
			guildId: "g1",
			messages: [
				{
					id: "m1",
					channel_id: "thread1",
					content: "hello",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: []
				} as never
			],
			enricher: {
				fetchChannel: async (channelId) =>
					channelId === "thread1"
						? ({
								id: "thread1",
								type: 11,
								name: "thread-name",
								parent_id: "parent1"
							} as never)
						: ({
								id: "parent1",
								type: 0,
								name: "support"
							} as never),
				fetchGuildMember: async () => null,
				fetchGuildRoles: async () => [],
				fetchPollAnswerVoters: async () => []
			}
		});

		expect(data.context.channels?.thread1).toEqual({
			name: "thread-name",
			type: "thread",
			parent_id: "parent1"
		});
		expect(data.context.channels?.parent1?.name).toBe("support");
	});
});
