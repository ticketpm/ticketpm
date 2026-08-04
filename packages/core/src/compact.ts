import { stringifyCanonicalJson } from "./canonical.js";
import { applyTranscriptCensorship } from "./censorship.js";
import type {
	APIPoll,
	APIPollVoter,
	APIReaction,
	APIReactionKind,
	ChannelInfo,
	CompactMessageInteraction,
	CompactMessageInteractionMetadata,
	CompactReferencedMessage,
	DiscordContext,
	DraftMessage,
	DraftMessageInteraction,
	DraftMessageInteractionMetadata,
	DraftMessageSnapshot,
	MemberInfo,
	RoleInfo,
	StoredCompactMessage,
	StoredTranscript,
	TranscriptBuildInput,
	TranscriptCensorshipOptions,
	UserInfo
} from "./types.js";
import { sortRecordByKey } from "./utils.js";

function compactInteractionMetadata(
	metadata: DraftMessageInteractionMetadata | null | undefined
): CompactMessageInteractionMetadata | undefined {
	if (!metadata) {
		return undefined;
	}

	return {
		id: metadata.id,
		type: metadata.type,
		user_id: metadata.user.id,
		name: metadata.name,
		original_response_message_id: metadata.original_response_message_id,
		triggering_interaction_metadata: compactInteractionMetadata(metadata.triggering_interaction_metadata)
	};
}

function compactInteraction(interaction: DraftMessageInteraction | null | undefined): CompactMessageInteraction | undefined {
	if (!interaction) {
		return undefined;
	}

	return {
		id: interaction.id,
		type: interaction.type,
		name: interaction.name,
		user_id: interaction.user.id
	};
}

function compactPoll(poll: APIPoll | undefined): APIPoll | undefined {
	if (!poll) {
		return undefined;
	}

	const { answer_voters, ...compactPollData } = poll;
	if (!answer_voters || Object.keys(answer_voters).length === 0) {
		return compactPollData;
	}

	return {
		...compactPollData,
		answer_voter_ids: Object.fromEntries(
			Object.entries(answer_voters).map(([answerId, voters]) => [Number(answerId), voters.map((voter: APIPollVoter) => voter.id)])
		)
	};
}

const REACTION_KINDS: readonly APIReactionKind[] = ["normal", "burst"];

function compactReaction(reaction: APIReaction): APIReaction {
	const { users, ...compactReactionData } = reaction;
	if (!users) {
		return compactReactionData;
	}

	const userIds: APIReaction["user_ids"] = { ...(compactReactionData.user_ids ?? {}) };
	for (const kind of REACTION_KINDS) {
		const kindUsers = users[kind];
		if (kindUsers?.length) {
			userIds[kind] = kindUsers.map((user) => user.id);
		}
	}

	return Object.keys(userIds).length > 0
		? {
				...compactReactionData,
				user_ids: userIds
			}
		: compactReactionData;
}

function compactUserIdentity(user: UserInfo): UserInfo {
	return (
		(pruneForExport(user) as UserInfo | undefined) ?? {
			id: user.id,
			username: user.username
		}
	);
}

function userIdentityKey(user: UserInfo): string {
	return stringifyCanonicalJson(compactUserIdentity(user));
}

function compactWebhookAuthorOverride(
	author: UserInfo | undefined,
	users: Record<string, UserInfo> | undefined
): UserInfo | undefined {
	if (!author?.webhook) {
		return undefined;
	}

	const contextAuthor = users?.[author.id];
	if (contextAuthor && userIdentityKey(author) === userIdentityKey(contextAuthor)) {
		return undefined;
	}

	return compactUserIdentity(author);
}

function compactReferencedMessage(message: DraftMessage, users: Record<string, UserInfo> | undefined): CompactReferencedMessage {
	return {
		id: message.id,
		type: message.type,
		author_id: message.author?.id,
		author: compactWebhookAuthorOverride(message.author, users),
		content: message.content,
		mention_everyone: message.mention_everyone || undefined,
		interaction: message.interaction ? { type: message.interaction.type } : undefined,
		interaction_metadata: message.interaction_metadata ? { type: message.interaction_metadata.type } : undefined,
		embeds: message.embeds,
		attachments: message.attachments,
		sticker_items: message.sticker_items
	};
}

function compactMessageSnapshot(snapshot: DraftMessageSnapshot): DraftMessageSnapshot {
	return {
		message: {
			...snapshot.message,
			mention_everyone: snapshot.message.mention_everyone || undefined
		}
	};
}

function compactMessage(message: DraftMessage, users: Record<string, UserInfo> | undefined): StoredCompactMessage {
	return {
		id: message.id,
		type: message.type,
		timestamp: message.timestamp,
		author_id: message.author?.id,
		author: compactWebhookAuthorOverride(message.author, users),
		content: message.content,
		mention_everyone: message.mention_everyone || undefined,
		edited_timestamp: message.edited_timestamp,
		attachments: message.attachments,
		embeds: message.embeds,
		reactions: message.reactions?.map(compactReaction),
		components: message.components,
		sticker_items: message.sticker_items,
		poll: compactPoll(message.poll),
		interaction_metadata: compactInteractionMetadata(message.interaction_metadata),
		interaction: compactInteraction(message.interaction),
		message_reference: message.message_reference,
		message_snapshots: message.message_snapshots?.map(compactMessageSnapshot),
		referenced_message: message.referenced_message
			? compactReferencedMessage(message.referenced_message, users)
			: message.referenced_message,
		mention_ids: message.mentions?.map((user) => user.id),
		mention_roles: message.mention_roles
	};
}

interface WebhookIdentityCandidate {
	count: number;
	firstMessageIndex: number;
	user: UserInfo;
}

/**
 * Choose the most common identity for each webhook as its shared context
 * entry. Only less-common username/avatar variants then need inline snapshots,
 * keeping long webhook-heavy transcripts compact after a rename.
 */
function selectCompactWebhookContext(messages: readonly DraftMessage[], context: DiscordContext): DiscordContext {
	const candidatesByUser = new Map<string, Map<string, WebhookIdentityCandidate>>();

	const registerCandidate = (author: UserInfo | undefined, messageIndex: number): void => {
		if (!author?.webhook) {
			return;
		}

		const identityKey = userIdentityKey(author);
		const candidates = candidatesByUser.get(author.id) ?? new Map<string, WebhookIdentityCandidate>();
		const existing = candidates.get(identityKey);
		if (existing) {
			existing.count += 1;
		} else {
			candidates.set(identityKey, {
				count: 1,
				firstMessageIndex: messageIndex,
				user: compactUserIdentity(author)
			});
		}
		candidatesByUser.set(author.id, candidates);
	};

	for (const [messageIndex, message] of messages.entries()) {
		registerCandidate(message.author, messageIndex);
		registerCandidate(message.referenced_message?.author, messageIndex);
	}

	if (candidatesByUser.size === 0) {
		return context;
	}

	const users = { ...(context.users ?? {}) };
	for (const [userId, candidates] of candidatesByUser) {
		let selected: WebhookIdentityCandidate | undefined;
		for (const candidate of candidates.values()) {
			if (
				!selected ||
				candidate.count > selected.count ||
				(candidate.count === selected.count && candidate.firstMessageIndex < selected.firstMessageIndex)
			) {
				selected = candidate;
			}
		}

		if (selected) {
			users[userId] = selected.user;
		}
	}

	return {
		...context,
		users
	};
}

/**
 * Prune `null`, `undefined`, and structurally empty values while preserving the
 * two context containers that are intentionally meaningful when non-empty.
 */
export function pruneForExport<T>(value: T): T | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}

	if (Array.isArray(value)) {
		const prunedArray = value
			.map((item) => pruneForExport(item))
			.filter((item): item is Exclude<typeof item, undefined> => item !== undefined);

		return prunedArray.length > 0 ? (prunedArray as unknown as T) : undefined;
	}

	if (typeof value === "object") {
		const objectValue = value as Record<string, unknown>;
		const prunedObject: Record<string, unknown> = {};

		for (const key of Object.keys(objectValue).sort()) {
			if (key === "members" || key === "roles") {
				const nestedRecord = objectValue[key] as Record<string, unknown> | undefined;
				if (nestedRecord && Object.keys(nestedRecord).length > 0) {
					prunedObject[key] = nestedRecord;
				}
				continue;
			}

			const prunedValue = pruneForExport(objectValue[key]);
			if (prunedValue !== undefined) {
				prunedObject[key] = prunedValue;
			}
		}

		return Object.keys(prunedObject).length > 0 ? (prunedObject as T) : undefined;
	}

	return value;
}

/**
 * Context ordering participates in canonical byte generation, so each map is
 * normalized explicitly before serialization.
 */
export function sortTranscriptContext(context: DiscordContext): DiscordContext {
	const transcriptChannelId = context.channel_id;
	const channels = { ...(context.channels ?? {}) };

	if (transcriptChannelId && !channels[transcriptChannelId]) {
		channels[transcriptChannelId] = { name: transcriptChannelId };
	}

	return {
		channel_id: transcriptChannelId,
		users: sortRecordByKey<UserInfo>(context.users),
		channels: sortRecordByKey<ChannelInfo>(channels),
		roles: sortRecordByKey<RoleInfo>(context.roles),
		members: sortRecordByKey<MemberInfo>(context.members),
		guild: context.guild,
		censored_ranges: sortRecordByKey(context.censored_ranges)
	};
}

/**
 * Produce the compact stored transcript format that the upload API hashes and
 * the viewer hydrates.
 */
export function buildStoredTranscript(input: TranscriptBuildInput, options?: TranscriptCensorshipOptions): StoredTranscript {
	const compactContext = selectCompactWebhookContext(input.messages, input.context);
	const compactTranscript: StoredTranscript = {
		messages: input.messages.map((message) => compactMessage(message, compactContext.users)),
		context: sortTranscriptContext(compactContext)
	};
	const censoredTranscript = applyTranscriptCensorship(compactTranscript, options);

	return (
		(pruneForExport(censoredTranscript) as StoredTranscript | undefined) ?? {
			messages: []
		}
	);
}

/**
 * Preserve the first-party chronological ordering convention for adapters that
 * receive newest-first collections from Discord APIs.
 */
export function sortMessagesChronologically<T extends { timestamp?: string }>(messages: readonly T[]): T[] {
	return [...messages].sort((left, right) => {
		const leftTimestamp = new Date(left.timestamp ?? 0).getTime();
		const rightTimestamp = new Date(right.timestamp ?? 0).getTime();
		return leftTimestamp - rightTimestamp;
	});
}
