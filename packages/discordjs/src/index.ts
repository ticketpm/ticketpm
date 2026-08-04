import {
	type APIAttachment,
	type APIPoll,
	type APIReaction,
	type APIReactionKind,
	type APIStickerItem,
	buildStoredTranscript,
	type ChannelInfo,
	type DiscordContext,
	type DraftMessage,
	formatExportUsername,
	type GuildInfo,
	isWebhookAuthor,
	type MemberInfo,
	type RoleInfo,
	type StoredTranscript,
	sortMessagesChronologically,
	type TranscriptBuildInput,
	type TranscriptCensorshipOptions,
	type UserInfo,
	type WebhookAuthorOptions
} from "@ticketpm/core";
import {
	type Collection,
	type Guild,
	type GuildMember,
	type Message,
	type MessageReaction,
	ReactionType,
	type Role,
	type User
} from "discord.js";

export interface DiscordJsChannelLike {
	id: string;
	name?: string | null;
	type: number;
	parentId?: string | null;
}

export interface DiscordJsContextOptions {
	baseContext?: DiscordContext;
	channel?: DiscordJsChannelLike;
	parentChannel?: DiscordJsChannelLike;
	guild?: Guild;
	roles?: Iterable<Role>;
	members?: Iterable<GuildMember>;
}

export interface CreateDiscordJsTranscriptOptions extends DiscordJsContextOptions, TranscriptCensorshipOptions {
	messages: readonly Message<boolean>[];
}

type DiscordJsPollLike = {
	question?: { text?: string };
	answers?: Array<{ answerId: number; text?: string }>;
	expiry?: Date | null;
	allowMultiselect?: boolean;
	layoutType?: number;
};

type MessageWithReferencedMessage = Message<boolean> & {
	referencedMessage?: Message<boolean> | null;
};

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

function roleColorToHex(role: Role): string | undefined {
	return role.color ? `#${role.color.toString(16).padStart(6, "0")}` : undefined;
}

/**
 * Convert a discord.js `User` into the transcript identity format used by the
 * core package.
 */
export function discordJsUserToUserInfo(user: User, options?: WebhookAuthorOptions): UserInfo {
	const webhook = isWebhookAuthor(
		{
			bot: user.bot,
			public_flags: undefined
		},
		options
	);

	const rawUser = user as User & {
		avatar?: string | null;
		discriminator?: string;
		globalName?: string | null;
	};

	return {
		id: user.id,
		username: formatExportUsername(
			{
				bot: user.bot,
				public_flags: undefined,
				username: user.username,
				discriminator: rawUser.discriminator ?? null
			},
			{ webhook }
		),
		display_name: !rawUser.globalName && (user.bot || webhook) ? user.username : undefined,
		global_name: rawUser.globalName ?? null,
		avatar: rawUser.avatar ?? null,
		bot: user.bot,
		webhook: webhook || undefined
	};
}

export function discordJsRoleToRoleInfo(role: Role): RoleInfo {
	return {
		name: role.name,
		color: roleColorToHex(role),
		position: role.position
	};
}

export function discordJsMemberToMemberInfo(member: GuildMember): MemberInfo {
	return {
		roles: [...member.roles.cache.keys()]
	};
}

export function discordJsChannelToChannelInfo(channel: DiscordJsChannelLike): ChannelInfo {
	return {
		name: channel.name ?? channel.id,
		type: channelTypeFromDiscord(channel.type),
		parent_id: channel.parentId ?? undefined
	};
}

function messageReactionToApiReaction(reaction: MessageReaction): APIReaction {
	return {
		count: reaction.count ?? 0,
		count_details: {
			burst: reaction.countDetails?.burst ?? 0,
			normal: reaction.countDetails?.normal ?? reaction.count ?? 0
		},
		me: Boolean(reaction.me),
		me_burst: Boolean(reaction.meBurst),
		emoji: {
			id: reaction.emoji.id ?? null,
			name: reaction.emoji.name ?? null,
			animated: reaction.emoji.animated ?? undefined
		},
		burst_colors: reaction.burstColors ?? []
	};
}

function attachmentToApiAttachment(attachment: {
	id: string;
	name: string | null;
	size: number;
	url: string;
	proxyURL: string;
	contentType?: string | null;
	width?: number | null;
	height?: number | null;
}): APIAttachment {
	return {
		id: attachment.id,
		filename: attachment.name ?? attachment.id,
		size: attachment.size,
		url: attachment.url,
		proxy_url: attachment.proxyURL,
		content_type: attachment.contentType ?? undefined,
		width: attachment.width ?? undefined,
		height: attachment.height ?? undefined
	};
}

function stickerToApiStickerItem(sticker: { id: string; name: string; format: number }): APIStickerItem {
	return {
		id: sticker.id,
		name: sticker.name,
		format_type: sticker.format as APIStickerItem["format_type"]
	};
}

function messageToPoll(message: Message<boolean>): APIPoll | undefined {
	const poll = (message as Message<boolean> & { poll?: DiscordJsPollLike }).poll;
	if (!poll?.answers || poll.answers.length === 0) {
		return undefined;
	}

	return {
		question: { text: poll.question?.text },
		answers: poll.answers.map((answer) => ({
			answer_id: Number((answer as { answerId?: number; id?: number }).answerId ?? (answer as { id?: number }).id ?? 0),
			poll_media: { text: answer.text ?? undefined }
		})),
		expiry: poll.expiry?.toISOString() ?? new Date(message.createdTimestamp).toISOString(),
		allow_multiselect: poll.allowMultiselect ?? false,
		layout_type: (poll.layoutType ?? 1) as APIPoll["layout_type"]
	};
}

function replyReference(message: Message<boolean>): DraftMessage["message_reference"] | undefined {
	if (!message.reference) {
		return undefined;
	}

	return {
		message_id: message.reference.messageId ?? undefined,
		channel_id: message.reference.channelId ?? undefined,
		guild_id: message.reference.guildId ?? undefined,
		type: message.reference.type
	};
}

function resolveReferencedMessage(message: Message<boolean>): Message<boolean> | undefined {
	const messageWithReference = message as MessageWithReferencedMessage;

	if (messageWithReference.referencedMessage) {
		return messageWithReference.referencedMessage;
	}

	const referencedMessageId = message.reference?.messageId;
	if (!referencedMessageId) {
		return undefined;
	}

	return message.channel?.messages?.cache?.get(referencedMessageId);
}

function discordJsMessageToDraftMessageInternal(message: Message<boolean>, seenMessageIds: Set<string>): DraftMessage {
	seenMessageIds.add(message.id);
	const referencedMessage = resolveReferencedMessage(message);

	return {
		id: message.id,
		type: message.type,
		channel_id: message.channelId,
		author: discordJsUserToUserInfo(message.author, {
			isWebhook: Boolean(message.webhookId),
			isInteractionResponse: Boolean(message.interactionMetadata || message.interaction),
			applicationId: message.applicationId ?? null
		}),
		timestamp: new Date(message.createdTimestamp).toISOString(),
		edited_timestamp: message.editedTimestamp ? new Date(message.editedTimestamp).toISOString() : null,
		mention_everyone: message.mentions.everyone,
		mentions: [...message.mentions.users.values()].map((user) => discordJsUserToUserInfo(user)),
		mention_roles: [...message.mentions.roles.keys()],
		attachments: [...message.attachments.values()].map((attachment) => attachmentToApiAttachment(attachment)),
		embeds: message.embeds.map((embed) => embed.toJSON()),
		reactions: [...message.reactions.cache.values()].map((reaction) => messageReactionToApiReaction(reaction)),
		components: message.components.map((component) => component.toJSON()) as DraftMessage["components"],
		sticker_items: [...message.stickers.values()].map((sticker) => stickerToApiStickerItem(sticker)),
		referenced_message:
			referencedMessage && !seenMessageIds.has(referencedMessage.id)
				? discordJsMessageToDraftMessageInternal(referencedMessage, seenMessageIds)
				: undefined,
		message_reference: replyReference(message),
		poll: messageToPoll(message),
		content: message.content
	};
}

/**
 * Convert a discord.js message into the core draft message format.
 */
export function discordJsMessageToDraftMessage(message: Message<boolean>): DraftMessage {
	return discordJsMessageToDraftMessageInternal(message, new Set());
}

/**
 * Build transcript context from discord.js objects that are already in memory.
 */
export function buildDiscordJsContext(messages: readonly Message<boolean>[], options?: DiscordJsContextOptions): DiscordContext {
	const normalizedMessages = messages.map((message) => discordJsMessageToDraftMessage(message));
	const users: Record<string, UserInfo> = {
		...(options?.baseContext?.users ?? {})
	};
	const channels: Record<string, ChannelInfo> = {
		...(options?.baseContext?.channels ?? {})
	};
	const roles: Record<string, RoleInfo> = {
		...(options?.baseContext?.roles ?? {})
	};
	const members: Record<string, MemberInfo> = {
		...(options?.baseContext?.members ?? {})
	};
	const transcriptChannelId = options?.baseContext?.channel_id ?? options?.channel?.id ?? normalizedMessages[0]?.channel_id;

	for (const message of normalizedMessages) {
		if (message.author) {
			users[message.author.id] = users[message.author.id] ?? message.author;
		}

		for (const mention of message.mentions ?? []) {
			users[mention.id] = users[mention.id] ?? mention;
		}

		if (message.referenced_message?.author) {
			users[message.referenced_message.author.id] =
				users[message.referenced_message.author.id] ?? message.referenced_message.author;
		}
	}

	if (options?.channel) {
		channels[options.channel.id] = discordJsChannelToChannelInfo(options.channel);
	}

	if (options?.parentChannel) {
		channels[options.parentChannel.id] = discordJsChannelToChannelInfo(options.parentChannel);
	}

	for (const role of options?.roles ?? options?.guild?.roles.cache.values() ?? []) {
		roles[role.id] = discordJsRoleToRoleInfo(role);
	}

	for (const member of options?.members ?? options?.guild?.members.cache.values() ?? []) {
		if (!users[member.user.id]) {
			continue;
		}

		const roleIds = [...member.roles.cache.keys()].filter((roleId) => roles[roleId]);
		if (roleIds.length > 0) {
			members[member.id] = { roles: roleIds };
		}
	}

	const guild: GuildInfo | undefined = options?.guild
		? {
				id: options.guild.id,
				name: options.guild.name,
				icon: options.guild.icon,
				icon_url: options.guild.iconURL() ?? undefined,
				approximate_member_count: options.guild.memberCount ?? undefined,
				owner_id: options.guild.ownerId ?? undefined,
				vanity_url_code: options.guild.vanityURLCode ?? undefined
			}
		: options?.baseContext?.guild;

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
 * Normalize and sort discord.js objects into the draft transcript shape used by
 * `TicketPmUploadClient.uploadDraftTranscript()`.
 */
function buildDiscordJsDraftTranscript(options: CreateDiscordJsTranscriptOptions): TranscriptBuildInput {
	const normalizedMessages = sortMessagesChronologically(
		options.messages.map((message) => discordJsMessageToDraftMessage(message))
	);
	const context = buildDiscordJsContext(options.messages, options);

	return {
		messages: normalizedMessages,
		context
	};
}

async function fetchAllReactionUsers(reaction: MessageReaction, kind: APIReactionKind): Promise<User[]> {
	const users = new Map<string, User>();
	let after: string | undefined;
	const type = kind === "burst" ? ReactionType.Super : ReactionType.Normal;

	while (true) {
		const page = await reaction.users.fetch({ type, limit: 100, after });
		for (const user of page.values()) {
			users.set(user.id, user);
		}

		if (page.size < 100) {
			break;
		}

		after = page.last()?.id;
		if (!after) {
			break;
		}
	}

	return [...users.values()];
}

/**
 * Build a draft transcript after fetching every normal and super-reaction
 * user.
 */
export async function createDiscordJsDraftTranscript(options: CreateDiscordJsTranscriptOptions): Promise<TranscriptBuildInput> {
	const transcript = buildDiscordJsDraftTranscript(options);
	const rawMessages = new Map(options.messages.map((message) => [message.id, message]));
	const reactionKinds: readonly APIReactionKind[] = ["normal", "burst"];

	for (const message of transcript.messages) {
		const rawMessage = rawMessages.get(message.id);
		if (!rawMessage || !message.reactions) {
			continue;
		}

		const rawReactions = [...rawMessage.reactions.cache.values()];
		for (const [reactionIndex, rawReaction] of rawReactions.entries()) {
			const reaction = message.reactions[reactionIndex];
			if (!reaction) {
				continue;
			}

			const reactionUsers = { ...(reaction.users ?? {}) };
			for (const kind of reactionKinds) {
				if (reaction.count_details[kind] <= 0) {
					continue;
				}

				const users = await fetchAllReactionUsers(rawReaction, kind);
				if (users.length === 0) {
					continue;
				}

				reactionUsers[kind] = users.map((user) => discordJsUserToUserInfo(user));
				for (const user of users) {
					const userInfo = discordJsUserToUserInfo(user);
					transcript.context.users = transcript.context.users ?? {};
					transcript.context.users[user.id] = transcript.context.users[user.id] ?? userInfo;
				}
			}

			if (Object.keys(reactionUsers).length > 0) {
				reaction.users = reactionUsers;
			}
		}
	}

	return transcript;
}

/** Fetch reaction users, then normalize, compact, and finalize the transcript. */
export async function createDiscordJsTranscript(options: CreateDiscordJsTranscriptOptions): Promise<StoredTranscript> {
	return buildStoredTranscript(await createDiscordJsDraftTranscript(options), options);
}

/**
 * Fetch messages from a discord.js channel manager, paging backwards until the
 * limit is reached or no more messages remain.
 */
export async function fetchMessagesUpToLimit(
	channel: {
		messages: {
			fetch(options: { limit: number; before?: string }): Promise<Collection<string, Message<boolean>>>;
		};
	},
	maxMessages = 1000,
	pageSize = 100
): Promise<Message<boolean>[]> {
	const messages: Message<boolean>[] = [];
	let before: string | undefined;

	while (messages.length < maxMessages) {
		const remaining = maxMessages - messages.length;
		const batch = await channel.messages.fetch({
			limit: Math.min(pageSize, remaining),
			before
		});

		if (batch.size === 0) {
			break;
		}

		const batchMessages = [...batch.values()];
		messages.push(...batchMessages);

		if (batchMessages.length < Math.min(pageSize, remaining)) {
			break;
		}

		before = batchMessages[batchMessages.length - 1]?.id;
	}

	return messages;
}
