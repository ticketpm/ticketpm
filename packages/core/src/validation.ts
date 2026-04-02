import { MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS, MAX_TRANSCRIPT_NESTING_DEPTH } from "./constants.js";
import type { StoredCompactMessage, StoredTranscript, UploadValidationIssue, UploadValidationResult } from "./types.js";
import { isRecord } from "./utils.js";

const ALLOWED_IMAGE_DOMAINS = new Set(["discordapp.com", "discordapp.net", "ticket.pm"]);
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

type UrlValidationResult = { ok: true } | { ok: false; path: string; reason: string; url?: string };

const VALID = { ok: true } as const;

function invalid(path: string, reason: string, url?: string): UrlValidationResult {
	const normalizedPath = path || "$";
	return url === undefined ? { ok: false, path: normalizedPath, reason } : { ok: false, path: normalizedPath, reason, url };
}

function buildPropertyPath(path: string, key: string): string {
	return path ? `${path}.${key}` : key;
}

function buildIndexPath(path: string, index: number): string {
	return `${path}[${index}]`;
}

function parseAllowedUrl(url: string, protocols: ReadonlySet<string>): URL | null {
	try {
		const parsed = new URL(url);
		return protocols.has(parsed.protocol) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Media URLs are tighter than regular links because the viewer renders them
 * directly.
 */
export function isValidMediaUrl(url: string | null | undefined): url is string {
	if (!url || typeof url !== "string") {
		return false;
	}

	const parsed = parseAllowedUrl(url, ALLOWED_LINK_PROTOCOLS);
	if (!parsed || parsed.protocol !== "https:") {
		return false;
	}

	const hostname = parsed.hostname.toLowerCase();
	return [...ALLOWED_IMAGE_DOMAINS].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * Clickable links can point anywhere as long as the scheme is safe.
 */
export function isValidLinkUrl(url: string | null | undefined): url is string {
	if (!url || typeof url !== "string") {
		return false;
	}

	return Boolean(parseAllowedUrl(url, ALLOWED_LINK_PROTOCOLS));
}

function validateTranscriptNestingDepth(payload: unknown, maxDepth = MAX_TRANSCRIPT_NESTING_DEPTH): UrlValidationResult {
	const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value: payload, path: "", depth: 0 }];

	while (stack.length > 0) {
		const current = stack.pop()!;

		if (Array.isArray(current.value)) {
			if (current.depth > maxDepth) {
				return invalid(current.path, `payload exceeds maximum nesting depth of ${maxDepth}`);
			}

			for (let index = current.value.length - 1; index >= 0; index -= 1) {
				const child = current.value[index];
				if (Array.isArray(child) || isRecord(child)) {
					stack.push({
						value: child,
						path: buildIndexPath(current.path, index),
						depth: current.depth + 1
					});
				}
			}

			continue;
		}

		if (!isRecord(current.value)) {
			continue;
		}

		if (current.depth > maxDepth) {
			return invalid(current.path, `payload exceeds maximum nesting depth of ${maxDepth}`);
		}

		const entries = Object.entries(current.value);
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const [key, child] = entries[index]!;
			if (Array.isArray(child) || isRecord(child)) {
				stack.push({
					value: child,
					path: buildPropertyPath(current.path, key),
					depth: current.depth + 1
				});
			}
		}
	}

	return VALID;
}

function validateOptionalMediaUrl(url: unknown, path: string): UrlValidationResult {
	if (url == null) {
		return VALID;
	}

	if (typeof url !== "string") {
		return invalid(path, "media URL must be a string", String(url));
	}

	return isValidMediaUrl(url) ? VALID : invalid(path, "media URL failed whitelist validation", url);
}

function validateOptionalLink(url: unknown, path: string): UrlValidationResult {
	if (url == null) {
		return VALID;
	}

	if (typeof url !== "string") {
		return invalid(path, "link URL must be a string", String(url));
	}

	return isValidLinkUrl(url) ? VALID : invalid(path, "link URL failed protocol validation", url);
}

function validatePreferredMediaUrl(proxyUrl: unknown, url: unknown, path: string): UrlValidationResult {
	return proxyUrl != null
		? validateOptionalMediaUrl(proxyUrl, `${path}.proxy_url`)
		: validateOptionalMediaUrl(url, `${path}.url`);
}

function validatePreferredIconUrl(proxyIconUrl: unknown, iconUrl: unknown, path: string): UrlValidationResult {
	return proxyIconUrl != null
		? validateOptionalMediaUrl(proxyIconUrl, `${path}.proxy_icon_url`)
		: validateOptionalMediaUrl(iconUrl, `${path}.icon_url`);
}

function validateOptionalPosterUrl(proxyPosterUrl: unknown, posterUrl: unknown, path: string): UrlValidationResult {
	return proxyPosterUrl != null
		? validateOptionalMediaUrl(proxyPosterUrl, `${path}.poster_proxy_url`)
		: validateOptionalMediaUrl(posterUrl, `${path}.poster_url`);
}

function validateAttachment(value: unknown, path: string): UrlValidationResult {
	if (!isRecord(value)) {
		return VALID;
	}

	const mediaResult = validatePreferredMediaUrl(value.proxy_url, value.url, path);
	if (!mediaResult.ok) {
		return mediaResult;
	}

	return validateOptionalPosterUrl(value.poster_proxy_url, value.poster_url, path);
}

function validateEmbedVideoItem(value: unknown, path: string): UrlValidationResult {
	if (!isRecord(value)) {
		return VALID;
	}

	if (value.proxy_url != null) {
		const proxyResult = validateOptionalMediaUrl(value.proxy_url, `${path}.proxy_url`);
		if (!proxyResult.ok) {
			return proxyResult;
		}
	}

	return validateOptionalLink(value.url, `${path}.url`);
}

function validateEmbed(value: unknown, path: string): UrlValidationResult {
	if (!isRecord(value)) {
		return VALID;
	}

	const embedUrlResult = validateOptionalLink(value.url, `${path}.url`);
	if (!embedUrlResult.ok) {
		return embedUrlResult;
	}

	if (isRecord(value.author)) {
		const authorUrlResult = validateOptionalLink(value.author.url, `${path}.author.url`);
		if (!authorUrlResult.ok) {
			return authorUrlResult;
		}

		const authorIconResult = validatePreferredIconUrl(value.author.proxy_icon_url, value.author.icon_url, `${path}.author`);
		if (!authorIconResult.ok) {
			return authorIconResult;
		}
	}

	if (isRecord(value.image)) {
		const imageResult = validatePreferredMediaUrl(value.image.proxy_url, value.image.url, `${path}.image`);
		if (!imageResult.ok) {
			return imageResult;
		}
	}

	if (isRecord(value.thumbnail)) {
		const thumbnailResult = validatePreferredMediaUrl(value.thumbnail.proxy_url, value.thumbnail.url, `${path}.thumbnail`);
		if (!thumbnailResult.ok) {
			return thumbnailResult;
		}
	}

	if (isRecord(value.video)) {
		const videoResult = validateEmbedVideoItem(value.video, `${path}.video`);
		if (!videoResult.ok) {
			return videoResult;
		}
	}

	if (isRecord(value.footer)) {
		const footerIconResult = validatePreferredIconUrl(value.footer.proxy_icon_url, value.footer.icon_url, `${path}.footer`);
		if (!footerIconResult.ok) {
			return footerIconResult;
		}
	}

	return VALID;
}

function validateComponentTree(value: unknown, path: string): UrlValidationResult {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const result = validateComponentTree(item, `${path}[${index}]`);
			if (!result.ok) {
				return result;
			}
		}

		return VALID;
	}

	if (!isRecord(value)) {
		return VALID;
	}

	if ("media" in value) {
		const mediaResult = isRecord(value.media)
			? validatePreferredMediaUrl(value.media.proxy_url, value.media.url, `${path}.media`)
			: VALID;
		if (!mediaResult.ok) {
			return mediaResult;
		}
	}

	if ("file" in value && isRecord(value.file)) {
		const fileUrlResult = validateOptionalLink(value.file.url, `${path}.file.url`);
		if (!fileUrlResult.ok) {
			return fileUrlResult;
		}

		const fileProxyResult = validateOptionalMediaUrl(value.file.proxy_url, `${path}.file.proxy_url`);
		if (!fileProxyResult.ok) {
			return fileProxyResult;
		}
	}

	if (typeof value.type === "number" && "url" in value) {
		const buttonUrlResult = validateOptionalLink(value.url, `${path}.url`);
		if (!buttonUrlResult.ok) {
			return buttonUrlResult;
		}
	}

	if ("components" in value) {
		const nestedComponentsResult = validateComponentTree(value.components, `${path}.components`);
		if (!nestedComponentsResult.ok) {
			return nestedComponentsResult;
		}
	}

	if ("items" in value) {
		const itemsResult = validateComponentTree(value.items, `${path}.items`);
		if (!itemsResult.ok) {
			return itemsResult;
		}
	}

	if ("accessory" in value) {
		const accessoryResult = validateComponentTree(value.accessory, `${path}.accessory`);
		if (!accessoryResult.ok) {
			return accessoryResult;
		}
	}

	return VALID;
}

function validateMessage(value: unknown, path: string): UrlValidationResult {
	if (!isRecord(value)) {
		return VALID;
	}

	if (Array.isArray(value.attachments)) {
		for (const [index, attachment] of value.attachments.entries()) {
			const attachmentResult = validateAttachment(attachment, `${path}.attachments[${index}]`);
			if (!attachmentResult.ok) {
				return attachmentResult;
			}
		}
	}

	if (Array.isArray(value.embeds)) {
		for (const [index, embed] of value.embeds.entries()) {
			const embedResult = validateEmbed(embed, `${path}.embeds[${index}]`);
			if (!embedResult.ok) {
				return embedResult;
			}
		}
	}

	if (value.components != null) {
		const componentsResult = validateComponentTree(value.components, `${path}.components`);
		if (!componentsResult.ok) {
			return componentsResult;
		}
	}

	if (isRecord(value.referenced_message)) {
		const referencedMessageResult = validateMessage(value.referenced_message, `${path}.referenced_message`);
		if (!referencedMessageResult.ok) {
			return referencedMessageResult;
		}
	}

	if (Array.isArray(value.message_snapshots)) {
		for (const [index, snapshot] of value.message_snapshots.entries()) {
			if (!isRecord(snapshot) || !isRecord(snapshot.message)) {
				continue;
			}

			const snapshotResult = validateMessage(snapshot.message, `${path}.message_snapshots[${index}].message`);
			if (!snapshotResult.ok) {
				return snapshotResult;
			}
		}
	}

	return VALID;
}

/**
 * Mirror the server-side URL walk so consumers can reject unsafe payloads
 * before they reach `POST /v2/upload`.
 */
export function validateTranscriptUrls(payload: unknown): UrlValidationResult {
	const nestingResult = validateTranscriptNestingDepth(payload);
	if (!nestingResult.ok) {
		return nestingResult;
	}

	const messages = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.messages)
			? payload.messages
			: null;

	if (!messages) {
		return VALID;
	}

	for (const [index, message] of messages.entries()) {
		const result = validateMessage(message, `messages[${index}]`);
		if (!result.ok) {
			return result;
		}
	}

	return VALID;
}

function resolveTranscriptChannelName(transcript: unknown): { ok: true; channelName: string } | { ok: false; body: string } {
	if (!isRecord(transcript)) {
		return {
			ok: false,
			body: "Invalid transcript context: either context.channel_id is missing, context.channels[context.channel_id] is missing, or context.channels[context.channel_id].name is missing"
		};
	}

	const context = isRecord(transcript.context) ? transcript.context : null;
	const channelId = typeof context?.channel_id === "string" && context.channel_id.length > 0 ? context.channel_id : null;
	const channels = isRecord(context?.channels) ? context.channels : null;
	const channel = channelId && channels && isRecord(channels[channelId]) ? channels[channelId] : null;
	const channelName = typeof channel?.name === "string" && channel.name.length > 0 ? channel.name : null;

	if (!channelName) {
		return {
			ok: false,
			body: "Invalid transcript context: either context.channel_id is missing, context.channels[context.channel_id] is missing, or context.channels[context.channel_id].name is missing"
		};
	}

	if (Array.from(channelName).length > MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS) {
		return {
			ok: false,
			body: "Invalid transcript context: context.channels[context.channel_id].name must be less or equal to 100 characters"
		};
	}

	return { ok: true, channelName };
}

/**
 * Validate the same structural requirements enforced by the upload API itself.
 */
export function validateTicketPmUploadPayload(transcript: unknown): UploadValidationResult {
	const errors: UploadValidationIssue[] = [];

	const urlValidation = validateTranscriptUrls(transcript);
	if (!urlValidation.ok) {
		errors.push({
			path: urlValidation.path,
			message: `${urlValidation.reason}${urlValidation.url ? `: ${urlValidation.url}` : ""}`
		});
	}

	const channelValidation = resolveTranscriptChannelName(transcript);
	if (!channelValidation.ok) {
		errors.push({
			path: "context.channel_id",
			message: channelValidation.body
		});
	}

	return {
		ok: errors.length === 0,
		errors
	};
}

function pushIssue(issues: UploadValidationIssue[], path: string, message: string): void {
	issues.push({ path, message });
}

function validateInteractionMetadataHydration(
	metadata: StoredCompactMessage["interaction_metadata"],
	users: Record<string, unknown> | undefined,
	path: string,
	issues: UploadValidationIssue[]
): void {
	if (!metadata) {
		return;
	}

	if (!users?.[metadata.user_id]) {
		pushIssue(issues, `${path}.user_id`, "interaction user cannot be hydrated from context.users");
	}

	validateInteractionMetadataHydration(
		metadata.triggering_interaction_metadata,
		users,
		`${path}.triggering_interaction_metadata`,
		issues
	);
}

/**
 * Upload acceptance is looser than viewer rendering. This helper closes that
 * gap by checking the compact hydration references that the renderer needs.
 */
export function validateViewerCompatibility(transcript: StoredTranscript): UploadValidationResult {
	const issues: UploadValidationIssue[] = [];
	const users = transcript.context?.users;
	const channelId = transcript.context?.channel_id;
	const channels = transcript.context?.channels;

	if (!channelId) {
		pushIssue(issues, "context.channel_id", "viewer header cannot resolve the primary channel");
	} else if (!channels?.[channelId]?.name) {
		pushIssue(issues, `context.channels.${channelId}`, "viewer header cannot resolve the primary channel name");
	}

	for (const [index, message] of transcript.messages.entries()) {
		const path = `messages[${index}]`;

		if (message.author_id && !users?.[message.author_id]) {
			pushIssue(issues, `${path}.author_id`, "author cannot be hydrated from context.users");
		}

		for (const [mentionIndex, mentionId] of (message.mention_ids ?? []).entries()) {
			if (!users?.[mentionId]) {
				pushIssue(issues, `${path}.mention_ids[${mentionIndex}]`, "mention cannot be hydrated from context.users");
			}
		}

		if (message.interaction && !users?.[message.interaction.user_id]) {
			pushIssue(issues, `${path}.interaction.user_id`, "interaction user cannot be hydrated from context.users");
		}

		validateInteractionMetadataHydration(message.interaction_metadata, users, `${path}.interaction_metadata`, issues);

		if (message.referenced_message?.author_id && !users?.[message.referenced_message.author_id]) {
			pushIssue(issues, `${path}.referenced_message.author_id`, "referenced author cannot be hydrated from context.users");
		}

		const answerVoterIds = message.poll?.answer_voter_ids;
		if (answerVoterIds) {
			for (const [answerId, voterIds] of Object.entries(answerVoterIds)) {
				for (const [voterIndex, voterId] of voterIds.entries()) {
					if (!users?.[voterId]) {
						pushIssue(
							issues,
							`${path}.poll.answer_voter_ids.${answerId}[${voterIndex}]`,
							"poll voter cannot be hydrated from context.users"
						);
					}
				}
			}
		}
	}

	return {
		ok: issues.length === 0,
		errors: issues
	};
}
