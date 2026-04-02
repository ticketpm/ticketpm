import {
	type APIPoll,
	buildStoredTranscript,
	type ChannelInfo,
	type DiscordContext,
	type DraftMessage,
	type DraftMessageInteraction,
	type DraftMessageInteractionMetadata,
	type DraftMessageSnapshot,
	formatExportUsername,
	type GuildInfo,
	isWebhookAuthor,
	type StoredTranscript,
	sortMessagesChronologically,
	type UserInfo
} from "@ticketpm/core";
import type { APIChannel, APIGuildMember, APIMessage, APIRole, APIUser } from "discord-api-types/v10";

const USER_MENTION_RE = /<@!?(\d+)>/g;
const CHANNEL_MENTION_RE = /<#(\d+)>/g;
const ROLE_MENTION_RE = /<@&(\d+)>/g;

type APIUserPrimaryGuild = UserInfo["primary_guild"];

export interface DiscordApiChannelRecord extends Pick<APIChannel, "id" | "type"> {
	name?: string | null;
	parent_id?: string | null;
}

export interface DiscordApiGuildMemberRecord extends Pick<APIGuildMember, "roles"> {
	user?: APIUser | null;
}

export interface DiscordApiRoleRecord extends Pick<APIRole, "id" | "name" | "position" | "color"> {}

export interface DiscordApiTranscriptData {
	messages: DraftMessage[];
	context: DiscordContext;
}

export interface DiscordApiContextOptions {
	baseContext?: DiscordContext;
}

export interface CreateDiscordApiTranscriptOptions extends DiscordApiContextOptions {
	messages: readonly APIMessage[];
}

export interface DiscordApiTranscriptEnricher {
	fetchUser?: (userId: string) => Promise<APIUser | null | undefined>;
	fetchChannel?: (channelId: string) => Promise<DiscordApiChannelRecord | null | undefined>;
	fetchGuildMember?: (guildId: string, userId: string) => Promise<DiscordApiGuildMemberRecord | null | undefined>;
	fetchGuildRoles?: (guildId: string) => Promise<readonly DiscordApiRoleRecord[]>;
	fetchPollAnswerVoters?: (input: { channelId: string; messageId: string; answerId: number }) => Promise<readonly APIUser[]>;
}

export interface BuildEnrichedDiscordApiTranscriptOptions extends DiscordApiContextOptions {
	messages: readonly APIMessage[];
	channelId: string;
	guildId?: string;
	guild?: GuildInfo;
	enricher: DiscordApiTranscriptEnricher;
}

type APIUserWithPrimaryGuild = APIUser & {
	primary_guild?: APIUserPrimaryGuild | null;
};

function extractIds(content: string, regex: RegExp): Set<string> {
	const ids = new Set<string>();
	for (const match of content.matchAll(regex)) {
		if (match[1]) {
			ids.add(match[1]);
		}
	}
	return ids;
}

function channelTypeFromDiscord(type: number): ChannelInfo["type"] {
	switch (type) {
		case 0:
			return "text";
		case 2:
			return "voice";
		case 11:
		case 12:
			return "thread";
		case 13:
			return "stage";
		default:
			return "text";
	}
}

function roleColorToHex(color: number): string | undefined {
	return color ? `#${color.toString(16).padStart(6, "0")}` : undefined;
}

function toUserInfo(user: APIUser, options?: { isWebhook?: boolean; applicationId?: string | null }): UserInfo {
	const webhook = isWebhookAuthor(
		{
			bot: user.bot,
			public_flags: user.public_flags
		},
		options
	);
	const extendedUser = user as APIUserWithPrimaryGuild;

	return {
		id: user.id,
		username: formatExportUsername(
			{
				bot: user.bot,
				public_flags: user.public_flags,
				username: user.username,
				discriminator: "discriminator" in user ? user.discriminator : null
			},
			{ webhook }
		),
		display_name: !user.global_name && (user.bot || webhook) ? user.username : undefined,
		global_name: user.global_name ?? null,
		avatar: user.avatar ?? null,
		bot: user.bot,
		webhook: webhook || undefined,
		public_flags: user.public_flags,
		avatar_decoration_data: user.avatar_decoration_data ?? null,
		primary_guild: extendedUser.primary_guild ?? null
	};
}

function normalizeInteractionMetadata(
	metadata: APIMessage["interaction_metadata"] | undefined | null
): DraftMessageInteractionMetadata | undefined {
	if (!metadata) {
		return undefined;
	}

	const withExtras = metadata as APIMessage["interaction_metadata"] & {
		name?: string;
		triggering_interaction_metadata?: APIMessage["interaction_metadata"];
	};

	return {
		id: metadata.id,
		type: metadata.type,
		user: toUserInfo(metadata.user),
		name: withExtras.name,
		original_response_message_id: metadata.original_response_message_id,
		triggering_interaction_metadata: normalizeInteractionMetadata(withExtras.triggering_interaction_metadata)
	};
}

function normalizeInteraction(interaction: APIMessage["interaction"] | undefined | null): DraftMessageInteraction | undefined {
	if (!interaction) {
		return undefined;
	}

	return {
		id: interaction.id,
		type: interaction.type,
		name: interaction.name,
		user: toUserInfo(interaction.user)
	};
}

function normalizePoll(poll: APIMessage["poll"] | undefined): APIPoll | undefined {
	if (!poll) {
		return undefined;
	}

	const withVoters = poll as APIMessage["poll"] & {
		answer_voters?: Record<number, APIUser[]>;
	};

	return {
		...poll,
		answer_voters: withVoters.answer_voters
			? Object.fromEntries(
					Object.entries(withVoters.answer_voters).map(([answerId, voters]) => [
						Number(answerId),
						voters.map((voter) => toUserInfo(voter))
					])
				)
			: undefined
	};
}

function normalizeMessageSnapshot(snapshot: NonNullable<APIMessage["message_snapshots"]>[number]): DraftMessageSnapshot {
	const snapshotMessage = snapshot.message as typeof snapshot.message & {
		mention_everyone?: boolean;
		poll?: APIMessage["poll"];
	};

	return {
		message: {
			content: snapshot.message.content,
			mention_everyone: snapshotMessage.mention_everyone,
			embeds: snapshot.message.embeds,
			attachments: snapshot.message.attachments,
			sticker_items: snapshot.message.sticker_items,
			components: snapshot.message.components as DraftMessageSnapshot["message"]["components"],
			poll: normalizePoll(snapshotMessage.poll),
			type: snapshot.message.type,
			flags: snapshot.message.flags
		}
	};
}

function normalizeReferencedMessage(message: APIMessage): DraftMessage {
	return {
		id: message.id,
		type: message.type,
		channel_id: message.channel_id,
		author: message.author
			? toUserInfo(message.author, {
					isWebhook: Boolean(message.webhook_id),
					applicationId: message.application_id ?? null
				})
			: undefined,
		timestamp: message.timestamp,
		edited_timestamp: message.edited_timestamp,
		mention_everyone: message.mention_everyone,
		mentions: message.mentions?.map((user) => toUserInfo(user)),
		mention_roles: message.mention_roles,
		attachments: message.attachments,
		embeds: message.embeds,
		reactions: message.reactions,
		components: message.components as DraftMessage["components"],
		sticker_items: message.sticker_items,
		message_reference: message.message_reference,
		interaction_metadata: normalizeInteractionMetadata(message.interaction_metadata),
		interaction: normalizeInteraction(message.interaction),
		poll: normalizePoll(message.poll),
		message_snapshots: message.message_snapshots?.map(normalizeMessageSnapshot),
		content: message.content
	};
}

/**
 * Normalize a single raw Discord API message into the richer draft structure
 * used by `@ticketpm/core`.
 */
export function normalizeDiscordApiMessage(message: APIMessage): DraftMessage {
	return {
		id: message.id,
		type: message.type,
		channel_id: message.channel_id,
		author: message.author
			? toUserInfo(message.author, {
					isWebhook: Boolean(message.webhook_id),
					applicationId: message.application_id ?? null
				})
			: undefined,
		timestamp: message.timestamp,
		edited_timestamp: message.edited_timestamp,
		mention_everyone: message.mention_everyone,
		mentions: message.mentions?.map((user) => toUserInfo(user)),
		mention_roles: message.mention_roles,
		attachments: message.attachments,
		embeds: message.embeds,
		reactions: message.reactions,
		components: message.components as DraftMessage["components"],
		sticker_items: message.sticker_items,
		referenced_message: message.referenced_message
			? normalizeReferencedMessage(message.referenced_message)
			: message.referenced_message,
		message_reference: message.message_reference,
		interaction_metadata: normalizeInteractionMetadata(message.interaction_metadata),
		interaction: normalizeInteraction(message.interaction),
		poll: normalizePoll(message.poll),
		message_snapshots: message.message_snapshots?.map(normalizeMessageSnapshot),
		content: message.content
	};
}

/**
 * Normalize several raw Discord API messages without changing their order.
 */
export function normalizeDiscordApiMessages(messages: readonly APIMessage[]): DraftMessage[] {
	return messages.map((message) => normalizeDiscordApiMessage(message));
}

/**
 * Build the viewer context from already-available REST payloads. This does not
 * fetch missing data.
 */
export function buildDiscordApiContext(messages: readonly APIMessage[], options?: DiscordApiContextOptions): DiscordContext {
	const normalizedMessages = normalizeDiscordApiMessages(messages);
	const users: Record<string, UserInfo> = {
		...(options?.baseContext?.users ?? {})
	};
	const channels: Record<string, ChannelInfo> = {
		...(options?.baseContext?.channels ?? {})
	};
	const roles = { ...(options?.baseContext?.roles ?? {}) };
	const members = { ...(options?.baseContext?.members ?? {}) };
	const guild = options?.baseContext?.guild;
	const transcriptChannelId = options?.baseContext?.channel_id ?? messages.find((message) => message.channel_id)?.channel_id;

	for (const [index, message] of normalizedMessages.entries()) {
		const rawMessage = messages[index]!;

		if (message.author) {
			users[message.author.id] = users[message.author.id] ?? message.author;
		}

		for (const mention of message.mentions ?? []) {
			users[mention.id] = users[mention.id] ?? mention;
		}

		if (rawMessage.mention_channels) {
			for (const channel of rawMessage.mention_channels) {
				channels[channel.id] = channels[channel.id] ?? {
					name: channel.name,
					type: channelTypeFromDiscord(channel.type)
				};
			}
		}

		if (message.referenced_message?.author) {
			users[message.referenced_message.author.id] =
				users[message.referenced_message.author.id] ?? message.referenced_message.author;
		}

		let interactionMetadata = message.interaction_metadata;
		while (interactionMetadata) {
			users[interactionMetadata.user.id] = users[interactionMetadata.user.id] ?? interactionMetadata.user;
			interactionMetadata = interactionMetadata.triggering_interaction_metadata;
		}

		if (message.interaction?.user) {
			users[message.interaction.user.id] = users[message.interaction.user.id] ?? message.interaction.user;
		}

		for (const voters of Object.values(message.poll?.answer_voters ?? {})) {
			for (const voter of voters) {
				users[voter.id] = users[voter.id] ?? voter;
			}
		}
	}

	if (transcriptChannelId && !channels[transcriptChannelId]) {
		channels[transcriptChannelId] = {
			name: transcriptChannelId
		};
	}

	return {
		channel_id: transcriptChannelId,
		users,
		channels,
		roles,
		members,
		guild
	};
}

/**
 * Fast path for callers that already have the context they need.
 */
export function createDiscordApiTranscript(options: CreateDiscordApiTranscriptOptions): StoredTranscript {
	const normalizedMessages = sortMessagesChronologically(normalizeDiscordApiMessages(options.messages));
	const context = buildDiscordApiContext(options.messages, {
		baseContext: options.baseContext
	});

	return buildStoredTranscript({
		messages: normalizedMessages,
		context
	});
}

/**
 * Enrich raw Discord API messages through caller-provided fetch hooks. This is
 * the extraction of the current first-party bot behavior without coupling to a
 * specific HTTP client implementation.
 */
export async function buildEnrichedDiscordApiTranscriptData(
	options: BuildEnrichedDiscordApiTranscriptOptions
): Promise<DiscordApiTranscriptData> {
	const sortedMessages = sortMessagesChronologically([...options.messages]);
	const normalizedMessages = normalizeDiscordApiMessages(sortedMessages);
	const context = buildDiscordApiContext(sortedMessages, {
		baseContext: options.baseContext
	});

	if (options.guild) {
		context.guild = options.guild;
	}

	const users = context.users ?? {};
	const channels = context.channels ?? {};
	const roles = context.roles ?? {};
	const members = context.members ?? {};
	const userIdsToFetch = new Set<string>();
	const channelIdsToFetch = new Set<string>();
	const roleIdsToFetch = new Set<string>();

	for (const rawMessage of sortedMessages) {
		if (rawMessage.content) {
			for (const userId of extractIds(rawMessage.content, USER_MENTION_RE)) {
				if (!users[userId]) {
					userIdsToFetch.add(userId);
				}
			}

			for (const channelId of extractIds(rawMessage.content, CHANNEL_MENTION_RE)) {
				if (!channels[channelId]) {
					channelIdsToFetch.add(channelId);
				}
			}

			for (const roleId of extractIds(rawMessage.content, ROLE_MENTION_RE)) {
				roleIdsToFetch.add(roleId);
			}
		}

		for (const roleId of rawMessage.mention_roles ?? []) {
			roleIdsToFetch.add(roleId);
		}
	}

	if (options.enricher.fetchChannel) {
		const currentChannel = await options.enricher.fetchChannel(options.channelId);
		if (currentChannel) {
			channels[options.channelId] = {
				name: currentChannel.name ?? options.channelId,
				type: channelTypeFromDiscord(currentChannel.type),
				parent_id: currentChannel.parent_id ?? undefined
			};

			if (currentChannel.parent_id) {
				const parentChannel = await options.enricher.fetchChannel(currentChannel.parent_id);
				if (parentChannel) {
					channels[parentChannel.id] = {
						name: parentChannel.name ?? parentChannel.id,
						type: channelTypeFromDiscord(parentChannel.type),
						parent_id: parentChannel.parent_id ?? undefined
					};
				}
			}
		}
	}

	await Promise.all(
		[...userIdsToFetch].map(async (userId) => {
			const user = await options.enricher.fetchUser?.(userId);
			if (user) {
				users[userId] = toUserInfo(user);
			}
		})
	);

	await Promise.all(
		[...channelIdsToFetch].map(async (channelId) => {
			const channel = await options.enricher.fetchChannel?.(channelId);
			if (channel) {
				channels[channel.id] = {
					name: channel.name ?? channel.id,
					type: channelTypeFromDiscord(channel.type),
					parent_id: channel.parent_id ?? undefined
				};
			}
		})
	);

	if (options.guildId) {
		const uniqueUserIds = new Set<string>();
		for (const message of normalizedMessages) {
			if (message.author) {
				uniqueUserIds.add(message.author.id);
			}

			for (const mention of message.mentions ?? []) {
				uniqueUserIds.add(mention.id);
			}

			if (message.referenced_message?.author) {
				uniqueUserIds.add(message.referenced_message.author.id);
			}

			let interactionMetadata = message.interaction_metadata;
			while (interactionMetadata) {
				uniqueUserIds.add(interactionMetadata.user.id);
				interactionMetadata = interactionMetadata.triggering_interaction_metadata;
			}

			if (message.interaction?.user) {
				uniqueUserIds.add(message.interaction.user.id);
			}
		}

		await Promise.all(
			[...uniqueUserIds].map(async (userId) => {
				const member = await options.enricher.fetchGuildMember?.(options.guildId!, userId);
				if (!member) {
					return;
				}

				members[userId] = {
					roles: [...(member.roles ?? [])]
				};

				if (member.user && !users[member.user.id]) {
					users[member.user.id] = toUserInfo(member.user);
				}

				for (const roleId of member.roles ?? []) {
					roleIdsToFetch.add(roleId);
				}
			})
		);

		if (roleIdsToFetch.size > 0) {
			const guildRoles = await options.enricher.fetchGuildRoles?.(options.guildId);
			if (guildRoles) {
				for (const role of guildRoles) {
					if (roleIdsToFetch.has(role.id)) {
						roles[role.id] = {
							name: role.name,
							color: roleColorToHex(role.color),
							position: role.position
						};
					}
				}
			}
		}

		for (const [userId, member] of Object.entries(members)) {
			const filteredRoles = member.roles.filter((roleId) => roles[roleId]);
			if (filteredRoles.length > 0) {
				members[userId] = { roles: filteredRoles };
			} else {
				delete members[userId];
			}
		}
	}

	if (options.enricher.fetchPollAnswerVoters) {
		for (const [index, rawMessage] of sortedMessages.entries()) {
			const poll = rawMessage.poll;
			if (!poll) {
				continue;
			}

			const channelId = rawMessage.channel_id ?? options.channelId;
			const answerVoters: Record<number, UserInfo[]> = {};

			for (const answer of poll.answers) {
				const voters = await options.enricher.fetchPollAnswerVoters({
					channelId,
					messageId: rawMessage.id,
					answerId: answer.answer_id
				});

				if (voters.length > 0) {
					answerVoters[answer.answer_id] = voters.map((voter) => toUserInfo(voter));
					for (const voter of voters) {
						users[voter.id] = users[voter.id] ?? toUserInfo(voter);
					}
				}
			}

			if (Object.keys(answerVoters).length > 0 && normalizedMessages[index]?.poll) {
				normalizedMessages[index]!.poll = {
					...normalizedMessages[index]!.poll!,
					answer_voters: answerVoters
				};
			}
		}
	}

	context.channel_id = options.baseContext?.channel_id ?? options.channelId;
	context.users = users;
	context.channels = channels;
	context.roles = roles;
	context.members = members;

	if (context.channel_id && !context.channels[context.channel_id]) {
		context.channels[context.channel_id] = {
			name: context.channel_id
		};
	}

	return {
		messages: normalizedMessages,
		context
	};
}

/**
 * Enrich, normalize, compact, and finalize a transcript in one call.
 */
export async function createEnrichedDiscordApiTranscript(
	options: BuildEnrichedDiscordApiTranscriptOptions
): Promise<StoredTranscript> {
	const data = await buildEnrichedDiscordApiTranscriptData(options);
	return buildStoredTranscript(data);
}
