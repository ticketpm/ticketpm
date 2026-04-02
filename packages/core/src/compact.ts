import type {
	APIPoll,
	APIPollVoter,
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

function compactReferencedMessage(message: DraftMessage): CompactReferencedMessage {
	return {
		id: message.id,
		type: message.type,
		author_id: message.author?.id,
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

function compactMessage(message: DraftMessage): StoredCompactMessage {
	return {
		id: message.id,
		type: message.type,
		timestamp: message.timestamp,
		author_id: message.author?.id,
		content: message.content,
		mention_everyone: message.mention_everyone || undefined,
		edited_timestamp: message.edited_timestamp,
		attachments: message.attachments,
		embeds: message.embeds,
		reactions: message.reactions,
		components: message.components,
		sticker_items: message.sticker_items,
		poll: compactPoll(message.poll),
		interaction_metadata: compactInteractionMetadata(message.interaction_metadata),
		interaction: compactInteraction(message.interaction),
		message_reference: message.message_reference,
		message_snapshots: message.message_snapshots?.map(compactMessageSnapshot),
		referenced_message: message.referenced_message
			? compactReferencedMessage(message.referenced_message)
			: message.referenced_message,
		mention_ids: message.mentions?.map((user) => user.id),
		mention_roles: message.mention_roles
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
		guild: context.guild
	};
}

/**
 * Produce the compact stored transcript format that the upload API hashes and
 * the viewer hydrates.
 */
export function buildStoredTranscript(input: TranscriptBuildInput): StoredTranscript {
	const compactTranscript: StoredTranscript = {
		messages: input.messages.map(compactMessage),
		context: sortTranscriptContext(input.context)
	};

	return (
		(pruneForExport(compactTranscript) as StoredTranscript | undefined) ?? {
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
