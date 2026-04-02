import type { Message } from "discord.js";
import { describe, expect, it } from "vitest";

import {
	buildDiscordJsContext,
	createDiscordJsTranscript,
	discordJsMessageToDraftMessage,
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

describe("@ticketpm/discordjs", () => {
	it("normalizes a discord.js message into a draft message", () => {
		const message = discordJsMessageToDraftMessage(createMockMessage());
		expect(message.author?.id).toBe("u1");
		expect(message.channel_id).toBe("c1");
		expect(message.content).toBe("hello");
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

	it("creates a compact transcript from discord.js messages", () => {
		const transcript = createDiscordJsTranscript({
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

	it("sorts discord.js messages chronologically before compact export", () => {
		const first = createMockMessage();
		const second = createMockMessage();
		first.id = "m2";
		first.createdTimestamp = Date.parse("2026-03-18T12:05:00.000Z");
		second.id = "m1";
		second.createdTimestamp = Date.parse("2026-03-18T12:00:00.000Z");

		const transcript = createDiscordJsTranscript({
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
});
