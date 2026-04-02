import { describe, expect, it } from "vitest";

import {
	buildDiscordApiContext,
	buildEnrichedDiscordApiTranscriptData,
	createDiscordApiTranscript,
	normalizeDiscordApiMessage
} from "../src/index.js";

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

		expect(transcript.messages.map((message: { id: string }) => message.id)).toEqual(["m1", "m2"]);
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

	it("preserves base context entries while hydrating mention channels and interaction users", () => {
		const context = buildDiscordApiContext(
			[
				{
					id: "m1",
					channel_id: "c1",
					content: "hello",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice-updated",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: [],
					mention_channels: [
						{
							id: "c2",
							name: "faq",
							type: 0
						}
					],
					interaction: {
						id: "i1",
						type: 2,
						name: "run",
						user: {
							id: "u2",
							username: "bot-user",
							avatar: null
						}
					},
					interaction_metadata: {
						id: "i2",
						type: 2,
						user: {
							id: "u3",
							username: "meta-user",
							avatar: null
						},
						triggering_interaction_metadata: {
							id: "i3",
							type: 2,
							user: {
								id: "u4",
								username: "nested-user",
								avatar: null
							}
						}
					},
					poll: {
						question: { text: "choose" },
						answers: [{ answer_id: 1, poll_media: { text: "a" } }],
						expiry: "2026-03-18T13:00:00.000Z",
						allow_multiselect: false,
						layout_type: 1,
						answer_voters: {
							1: [
								{
									id: "u5",
									username: "voter",
									avatar: null
								}
							]
						}
					}
				} as never
			],
			{
				baseContext: {
					channel_id: "base-channel",
					users: {
						u1: {
							id: "u1",
							username: "alice-existing"
						}
					}
				}
			}
		);

		expect(context.channel_id).toBe("base-channel");
		expect(context.users?.u1?.username).toBe("alice-existing");
		expect(context.users?.u2?.username).toBe("bot-user");
		expect(context.users?.u3?.username).toBe("meta-user");
		expect(context.users?.u4?.username).toBe("nested-user");
		expect(context.users?.u5?.username).toBe("voter");
		expect(context.channels?.c2).toEqual({
			name: "faq",
			type: "text"
		});
	});

	it("filters unresolved guild member roles while enriching mentioned channels", async () => {
		const data = await buildEnrichedDiscordApiTranscriptData({
			channelId: "c1",
			guildId: "g1",
			messages: [
				{
					id: "m1",
					channel_id: "c1",
					content: "check <#2> <@&11> <@&22>",
					timestamp: "2026-03-18T12:00:00.000Z",
					author: {
						id: "u1",
						username: "alice",
						avatar: null
					},
					mentions: [],
					attachments: [],
					embeds: [],
					mention_roles: ["11", "22"]
				} as never
			],
			enricher: {
				fetchChannel: async (channelId) =>
					channelId === "2"
						? ({
								id: "2",
								type: 0,
								name: "faq"
							} as never)
						: ({
								id: "c1",
								type: 0,
								name: "support"
							} as never),
				fetchGuildMember: async () =>
					({
						roles: ["11", "22"]
					}) as never,
				fetchGuildRoles: async () => [
					{
						id: "11",
						name: "Support",
						position: 1,
						color: 0x00ff00
					} as never
				]
			}
		});

		expect(data.context.channels?.["2"]).toEqual({
			name: "faq",
			type: "text"
		});
		expect(data.context.roles).toEqual({
			"11": {
				name: "Support",
				color: "#00ff00",
				position: 1
			}
		});
		expect(data.context.members?.u1).toEqual({
			roles: ["11"]
		});
	});
});
