import { Collection, type Message, ReactionType } from "discord.js";
import { describe, expect, it } from "vitest";

import {
	buildDiscordJsContext,
	createDiscordJsDraftTranscript,
	createDiscordJsTranscript,
	discordJsMessageToDraftMessage,
	discordJsUserToUserInfo,
	fetchMessagesUpToLimit
} from "../src/index.js";

function createMockMessage(): Message<boolean> {
	return {
		id: "m1",
		type: 0,
		channelId: "c1",
		content: "hello",
		createdTimestamp: Date.parse("2026-03-18T12:00:00.000Z"),
		editedTimestamp: null,
		webhookId: null,
		applicationId: null,
		author: {
			id: "u1",
			bot: false,
			username: "alice",
			avatar: "avatar-hash",
			avatarURL: () => null
		},
		mentions: {
			everyone: false,
			users: new Map(),
			roles: new Map()
		},
		attachments: new Map(),
		embeds: [],
		reactions: {
			cache: new Map()
		},
		components: [],
		stickers: new Map(),
		reference: null
	} as unknown as Message<boolean>;
}

function setReplyTarget(reply: Message<boolean>, referenced: Message<boolean>, options?: { guildId?: string | null }): void {
	Object.assign(reply, {
		reference: {
			messageId: referenced.id,
			channelId: referenced.channelId,
			guildId: options?.guildId ?? "g1",
			type: 0
		}
	});
}

function setMessageCache(messages: Message<boolean>[]): void {
	const cache = new Map(messages.map((message) => [message.id, message]));
	const channel = {
		messages: {
			cache
		}
	};

	for (const message of messages) {
		Object.assign(message, { channel });
	}
}

describe("@ticketpm/discordjs", () => {
	it("normalizes a discord.js message into a draft message", () => {
		const message = discordJsMessageToDraftMessage(createMockMessage());
		expect(message.author?.id).toBe("u1");
		expect(message.channel_id).toBe("c1");
		expect(message.content).toBe("hello");
	});

	it("classifies application-owned channel webhooks as webhooks", () => {
		const rawMessage = createMockMessage();
		Object.assign(rawMessage, {
			webhookId: "wh1",
			applicationId: "app1",
			interactionMetadata: null,
			interaction: null,
			author: {
				id: "wh1",
				bot: true,
				username: "Support",
				avatar: "avatar-1",
				discriminator: "0000",
				avatarURL: () => null
			}
		});

		expect(discordJsMessageToDraftMessage(rawMessage).author?.webhook).toBe(true);
	});

	it("keeps interaction responses classified as app messages", () => {
		const rawMessage = createMockMessage();
		Object.assign(rawMessage, {
			webhookId: "app1",
			applicationId: "app1",
			interactionMetadata: {
				id: "interaction-1"
			},
			author: {
				id: "app1",
				bot: true,
				username: "Ticket Bot",
				avatar: "avatar-1",
				discriminator: "0000",
				avatarURL: () => null
			}
		});

		const message = discordJsMessageToDraftMessage(rawMessage);
		expect(message.author?.webhook).toBeUndefined();
		expect(message.author?.bot).toBe(true);
	});

	it("uses a cached referenced message for reply draft references", () => {
		const reply = createMockMessage();
		const referenced = createMockMessage();
		Object.assign(reply, {
			id: "m2",
			content: "reply"
		});
		Object.assign(referenced, {
			content: "original"
		});
		setReplyTarget(reply, referenced);
		setMessageCache([reply, referenced]);

		const message = discordJsMessageToDraftMessage(reply);

		expect(message.message_reference).toEqual({
			message_id: "m1",
			channel_id: "c1",
			guild_id: "g1",
			type: 0
		});
		expect(message.referenced_message).toMatchObject({
			id: "m1",
			content: "original",
			author: {
				id: "u1"
			}
		});
	});

	it("keeps reply references when the referenced message is not cached", () => {
		const reply = createMockMessage();
		const referenced = createMockMessage();
		Object.assign(reply, {
			id: "m2"
		});
		setReplyTarget(reply, referenced);
		Object.assign(reply, {
			channel: {
				messages: {
					cache: new Map()
				}
			}
		});

		const message = discordJsMessageToDraftMessage(reply);

		expect(message.message_reference?.message_id).toBe("m1");
		expect(message.referenced_message).toBeUndefined();
	});

	it("keeps backward-compatible referencedMessage objects", () => {
		const reply = createMockMessage();
		const referenced = createMockMessage();
		Object.assign(reply, {
			id: "m2",
			referencedMessage: referenced
		});
		Object.assign(referenced, {
			content: "original"
		});

		const message = discordJsMessageToDraftMessage(reply);

		expect(message.referenced_message).toMatchObject({
			id: "m1",
			content: "original"
		});
	});

	it("does not recurse forever when reply references are cyclic", () => {
		const first = createMockMessage();
		const second = createMockMessage();
		Object.assign(first, {
			id: "m1"
		});
		Object.assign(second, {
			id: "m2"
		});
		setReplyTarget(first, second);
		setReplyTarget(second, first);
		setMessageCache([first, second]);

		const message = discordJsMessageToDraftMessage(first);

		expect(message.referenced_message?.id).toBe("m2");
		expect(message.referenced_message?.message_reference?.message_id).toBe("m1");
		expect(message.referenced_message?.referenced_message).toBeUndefined();
	});

	it("keeps the raw avatar hash instead of serializing a CDN URL", () => {
		const user = discordJsUserToUserInfo({
			id: "u1",
			bot: false,
			username: "alice",
			avatar: "a_avatarhash",
			avatarURL: () => "https://cdn.discordapp.com/avatars/u1/a_avatarhash.gif"
		} as never);

		expect(user.avatar).toBe("a_avatarhash");
	});

	it("builds transcript context from message and channel data", () => {
		const mockMessage = createMockMessage();
		const context = buildDiscordJsContext([mockMessage], {
			channel: {
				id: "c1",
				name: "support",
				type: 0
			}
		});

		expect(context.channel_id).toBe("c1");
		expect(context.channels?.c1?.name).toBe("support");
		expect(context.users?.u1?.username).toBe("alice");
	});

	it("adds cached referenced message authors to transcript context users", () => {
		const reply = createMockMessage();
		const referenced = createMockMessage();
		Object.assign(referenced, {
			author: {
				id: "u2",
				bot: false,
				username: "bob",
				avatar: null,
				avatarURL: () => null
			}
		});
		Object.assign(reply, {
			id: "m2"
		});
		setReplyTarget(reply, referenced);
		setMessageCache([reply, referenced]);

		const context = buildDiscordJsContext([reply]);

		expect(context.users?.u1?.username).toBe("alice");
		expect(context.users?.u2?.username).toBe("bob");
	});

	it("creates a compact transcript from discord.js messages", async () => {
		const transcript = await createDiscordJsTranscript({
			messages: [createMockMessage()],
			channel: {
				id: "c1",
				name: "support",
				type: 0
			}
		});

		expect(transcript.messages[0]).toMatchObject({
			id: "m1",
			author_id: "u1"
		});
		expect(transcript.context?.channels?.c1?.name).toBe("support");
	});

	it("paginates, fetches, and compacts normal and super-reaction users", async () => {
		const message = createMockMessage();
		const fetchRequests: Array<{ type: ReactionType; after: string | undefined }> = [];
		const normalUsers = Array.from({ length: 101 }, (_, index) => ({
			id: `normal-${index.toString().padStart(3, "0")}`,
			bot: false,
			username: `normal-${index}`,
			avatar: null
		}));
		const burstUser = {
			id: "burst-1",
			bot: false,
			username: "carol",
			avatar: null
		};
		Object.assign(message.reactions, {
			cache: new Map([
				[
					"party:e1",
					{
						count: 102,
						countDetails: { normal: 101, burst: 1 },
						me: false,
						meBurst: false,
						emoji: { id: "e1", name: "party", animated: false },
						burstColors: ["#ff0000"],
						users: {
							fetch: async ({ type, after }: { type: ReactionType; after?: string }) => {
								fetchRequests.push({ type, after });
								if (type === ReactionType.Super) {
									return new Collection([[burstUser.id, burstUser]]);
								}

								const page = after ? normalUsers.slice(100) : normalUsers.slice(0, 100);
								return new Collection(page.map((user) => [user.id, user]));
							}
						}
					}
				]
			])
		});

		const transcript = await createDiscordJsTranscript({ messages: [message] });

		expect(fetchRequests).toEqual([
			{ type: ReactionType.Normal, after: undefined },
			{ type: ReactionType.Normal, after: "normal-099" },
			{ type: ReactionType.Super, after: undefined }
		]);
		expect(transcript.messages[0]?.reactions?.[0]?.user_ids?.normal).toHaveLength(101);
		expect(transcript.messages[0]?.reactions?.[0]?.user_ids?.normal?.at(-1)).toBe("normal-100");
		expect(transcript.messages[0]?.reactions?.[0]?.user_ids?.burst).toEqual(["burst-1"]);
		expect(transcript.context?.users?.["normal-100"]?.username).toBe("normal-100");
		expect(transcript.context?.users?.["burst-1"]?.username).toBe("carol");
	});

	it("creates a draft transcript for media-proxied uploads", async () => {
		const transcript = await createDiscordJsDraftTranscript({
			messages: [createMockMessage()],
			channel: {
				id: "c1",
				name: "support",
				type: 0
			}
		});

		expect(transcript.messages[0]).toMatchObject({
			id: "m1",
			channel_id: "c1",
			author: {
				id: "u1",
				avatar: "avatar-hash"
			}
		});
		expect(transcript.context.channels?.c1?.name).toBe("support");
	});

	it("sorts discord.js messages chronologically before compact export", async () => {
		const first = createMockMessage();
		const second = createMockMessage();
		first.id = "m2";
		first.createdTimestamp = Date.parse("2026-03-18T12:05:00.000Z");
		second.id = "m1";
		second.createdTimestamp = Date.parse("2026-03-18T12:00:00.000Z");

		const transcript = await createDiscordJsTranscript({
			messages: [first, second],
			channel: {
				id: "c1",
				name: "support",
				type: 0
			}
		});

		expect(transcript.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
	});

	it("fetches messages in pages until the requested limit", async () => {
		const messageThree = createMockMessage();
		const messageTwo = createMockMessage();
		const messageOne = createMockMessage();
		messageThree.id = "m3";
		messageTwo.id = "m2";
		messageOne.id = "m1";

		const pageOne = new Map<string, Message<boolean>>([
			["m3", messageThree],
			["m2", messageTwo]
		]);
		const pageTwo = new Map<string, Message<boolean>>([["m1", messageOne]]);
		const fetchCalls: Array<{ limit: number; before?: string }> = [];

		const messages = await fetchMessagesUpToLimit(
			{
				messages: {
					fetch: async (options) => {
						fetchCalls.push(options);
						return (fetchCalls.length === 1 ? pageOne : pageTwo) as never;
					}
				}
			},
			3,
			2
		);

		expect(messages.map((message) => message.id)).toEqual(["m3", "m2", "m1"]);
		expect(fetchCalls).toEqual([
			{ limit: 2, before: undefined },
			{ limit: 1, before: "m2" }
		]);
	});

	it("filters member roles to known roles and includes guild metadata in context", () => {
		const role = {
			id: "r1",
			name: "Support",
			color: 0xff0000,
			position: 1
		};
		const participantUser = {
			id: "u1",
			bot: false,
			username: "alice",
			avatarURL: () => null
		};
		const unrelatedUser = {
			id: "u2",
			bot: false,
			username: "bob",
			avatarURL: () => null
		};
		const context = buildDiscordJsContext([createMockMessage()], {
			channel: {
				id: "c1",
				name: "support",
				type: 0
			},
			roles: [role] as never,
			members: [
				{
					id: "u1",
					user: participantUser,
					roles: {
						cache: new Map([
							["r1", role],
							[
								"r2",
								{
									id: "r2",
									name: "Ignored",
									color: 0,
									position: 0
								}
							]
						])
					}
				},
				{
					id: "u2",
					user: unrelatedUser,
					roles: {
						cache: new Map([["r1", role]])
					}
				}
			] as never,
			guild: {
				id: "g1",
				name: "Guild",
				icon: "guild-icon",
				iconURL: () => "https://cdn.discordapp.com/icons/g1/icon.png",
				memberCount: 42,
				ownerId: "u1",
				vanityURLCode: "support",
				roles: {
					cache: new Map()
				},
				members: {
					cache: new Map()
				}
			} as never
		});

		expect(context.roles?.r1).toEqual({
			name: "Support",
			color: "#ff0000",
			position: 1
		});
		expect(context.members?.u1).toEqual({
			roles: ["r1"]
		});
		expect(context.members?.u2).toBeUndefined();
		expect(context.users?.u2).toBeUndefined();
		expect(context.guild).toEqual({
			id: "g1",
			name: "Guild",
			icon: "guild-icon",
			icon_url: "https://cdn.discordapp.com/icons/g1/icon.png",
			approximate_member_count: 42,
			owner_id: "u1",
			vanity_url_code: "support"
		});
	});

	it("uses cached guild members for transcript participant role metadata", () => {
		const role = {
			id: "r1",
			name: "Support",
			color: 0x00ff00,
			position: 2
		};
		const unrelatedUser = {
			id: "u2",
			bot: false,
			username: "bob",
			avatarURL: () => null
		};
		const context = buildDiscordJsContext([createMockMessage()], {
			guild: {
				id: "g1",
				name: "Guild",
				icon: null,
				iconURL: () => null,
				memberCount: 42,
				ownerId: "u1",
				vanityURLCode: null,
				roles: {
					cache: new Map([["r1", role]])
				},
				members: {
					cache: new Map([
						[
							"u1",
							{
								id: "u1",
								user: createMockMessage().author,
								roles: {
									cache: new Map([["r1", role]])
								}
							}
						],
						[
							"u2",
							{
								id: "u2",
								user: unrelatedUser,
								roles: {
									cache: new Map([["r1", role]])
								}
							}
						]
					])
				}
			} as never
		});

		expect(context.members?.u1).toEqual({
			roles: ["r1"]
		});
		expect(context.members?.u2).toBeUndefined();
		expect(context.users?.u2).toBeUndefined();
	});

	it("stops pagination when a fetch returns a partial page before the limit", async () => {
		const messageThree = createMockMessage();
		const messageTwo = createMockMessage();
		const messageOne = createMockMessage();
		messageThree.id = "m3";
		messageTwo.id = "m2";
		messageOne.id = "m1";

		const pageOne = new Map<string, Message<boolean>>([
			["m3", messageThree],
			["m2", messageTwo]
		]);
		const pageTwo = new Map<string, Message<boolean>>([["m1", messageOne]]);
		const fetchCalls: Array<{ limit: number; before?: string }> = [];

		const messages = await fetchMessagesUpToLimit(
			{
				messages: {
					fetch: async (options) => {
						fetchCalls.push(options);
						return (fetchCalls.length === 1 ? pageOne : pageTwo) as never;
					}
				}
			},
			5,
			2
		);

		expect(messages.map((message) => message.id)).toEqual(["m3", "m2", "m1"]);
		expect(fetchCalls).toEqual([
			{ limit: 2, before: undefined },
			{ limit: 2, before: "m2" }
		]);
	});

	it("propagates Discord API errors during pagination", async () => {
		const discordError = new Error("Missing Access");

		await expect(
			fetchMessagesUpToLimit(
				{
					messages: {
						fetch: async () => {
							throw discordError;
						}
					}
				},
				10,
				5
			)
		).rejects.toBe(discordError);
	});
});
