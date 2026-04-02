import type { DiscordContext, DraftMessage, GuildInfo, UserInfo } from "./types.js";
import { isRecord, joinUrl, readTrimmedString } from "./utils.js";

type UploadHeadersOptions = {
	contentType: string;
	token?: string;
};

export interface TicketPmMediaProxyClientOptions {
	/**
	 * Base media API URL, for example `https://m.ticket.pm/v2`.
	 *
	 * This value controls both where upload requests are sent and which proxy
	 * URLs are generated on successful uploads.
	 */
	baseUrl: string;
	/**
	 * Optional bearer token or raw token string. Raw values are normalized into
	 * the `Authorization: Bearer ...` header automatically.
	 */
	token?: string;
	/**
	 * Optional custom fetch implementation for environments that need their own
	 * HTTP transport, instrumentation, retries, or authentication pipeline.
	 */
	fetch?: typeof fetch;
}

export type UploadProgressCallback = (completed: number, total: number) => void;

function buildUploadHeaders(options: UploadHeadersOptions): HeadersInit {
	const headers = new Headers({ "Content-Type": options.contentType });
	if (options.token) {
		headers.set("Authorization", options.token.startsWith("Bearer ") ? options.token : `Bearer ${options.token}`);
	}
	return headers;
}

function isValidAvatarHash(avatar: string | null | undefined): avatar is string {
	if (typeof avatar !== "string") {
		return false;
	}

	const normalized = avatar.trim();
	return normalized.length > 0 && /^[a-zA-Z0-9_]+$/.test(normalized);
}

function buildAnimatedAssetUrl(baseUrl: string, kind: "avatars" | "icons", hash: string, animated: boolean): string {
	const url = new URL(joinUrl(baseUrl, `/${kind}/${hash}`));
	if (animated) {
		url.searchParams.set("animated", "true");
	}
	return url.toString();
}

function isLikelyMediaObject(record: Record<string, unknown>): boolean {
	return (
		readTrimmedString(record, "proxy_url") !== undefined ||
		readTrimmedString(record, "content_type") !== undefined ||
		readTrimmedString(record, "filename") !== undefined ||
		typeof record.width === "number" ||
		typeof record.height === "number" ||
		typeof record.size === "number"
	);
}

/**
 * Stateful client with in-memory dedupe so repeated avatar/icon/media uploads
 * inside a single export run do not fan out into redundant requests.
 */
export class TicketPmMediaProxyClient {
	private readonly fetchImpl: typeof fetch;
	private readonly avatarUploadCache = new Map<string, Promise<string | undefined>>();
	private readonly iconUploadCache = new Map<string, Promise<string | undefined>>();
	private readonly attachmentUploadCache = new Map<string, Promise<string | undefined>>();

	public constructor(private readonly options: TicketPmMediaProxyClientOptions) {
		this.fetchImpl = options.fetch ?? fetch;
	}

	public get baseUrl(): string {
		return this.options.baseUrl;
	}

	/**
	 * Upload a Discord avatar hash to the configured media proxy.
	 *
	 * On success, the returned value is the proxy avatar URL. On failure, this
	 * returns `undefined` and the caller is expected to keep the original avatar
	 * hash untouched in transcript data.
	 */
	public async uploadAvatarHash(hash: string, userId: string): Promise<string | undefined> {
		if (!isValidAvatarHash(hash)) {
			return undefined;
		}

		const normalizedHash = hash.trim();
		const cached = this.avatarUploadCache.get(normalizedHash);
		if (cached) {
			return cached;
		}

		const request = (async () => {
			const response = await this.fetchImpl(joinUrl(this.options.baseUrl, "/avatars/upload"), {
				method: "POST",
				headers: buildUploadHeaders({
					contentType: "application/json",
					token: this.options.token
				}),
				body: JSON.stringify({ hash: normalizedHash, id: userId })
			});

			if (!response.ok) {
				return undefined;
			}

			const payload = (await response.json()) as { hash?: unknown };
			if (typeof payload.hash !== "string" || payload.hash.length === 0) {
				return undefined;
			}

			return buildAnimatedAssetUrl(this.options.baseUrl, "avatars", payload.hash, normalizedHash.startsWith("a_"));
		})();

		this.avatarUploadCache.set(normalizedHash, request);
		request.catch(() => {
			this.avatarUploadCache.delete(normalizedHash);
		});

		return request;
	}

	public async uploadGuildIconHash(hash: string, guildId: string): Promise<string | undefined> {
		if (!isValidAvatarHash(hash)) {
			return undefined;
		}

		const normalizedHash = hash.trim();
		const cached = this.iconUploadCache.get(normalizedHash);
		if (cached) {
			return cached;
		}

		const request = (async () => {
			const response = await this.fetchImpl(joinUrl(this.options.baseUrl, "/icons/upload"), {
				method: "POST",
				headers: buildUploadHeaders({
					contentType: "application/json",
					token: this.options.token
				}),
				body: JSON.stringify({ hash: normalizedHash, id: guildId })
			});

			if (!response.ok) {
				return undefined;
			}

			const payload = (await response.json()) as { hash?: unknown };
			if (typeof payload.hash !== "string" || payload.hash.length === 0) {
				return undefined;
			}

			return buildAnimatedAssetUrl(this.options.baseUrl, "icons", payload.hash, normalizedHash.startsWith("a_"));
		})();

		this.iconUploadCache.set(normalizedHash, request);
		request.catch(() => {
			this.iconUploadCache.delete(normalizedHash);
		});

		return request;
	}

	/**
	 * Upload a media URL to the configured proxy.
	 *
	 * If the proxy is unavailable, returns a non-2xx response, or produces an
	 * invalid payload, this returns `undefined`. Callers should treat that as a
	 * no-rewrite outcome and keep the original media URL fields.
	 */
	public async uploadAttachmentUrl(url: string): Promise<string | undefined> {
		const cached = this.attachmentUploadCache.get(url);
		if (cached) {
			return cached;
		}

		const request = (async () => {
			const response = await this.fetchImpl(joinUrl(this.options.baseUrl, "/attachments/upload"), {
				method: "POST",
				headers: buildUploadHeaders({
					contentType: "application/json",
					token: this.options.token
				}),
				body: JSON.stringify({ url })
			});

			if (!response.ok) {
				return undefined;
			}

			const payload = (await response.json()) as { hash?: unknown };
			return typeof payload.hash === "string" && payload.hash.length > 0
				? joinUrl(this.options.baseUrl, `/attachments/${payload.hash}`)
				: undefined;
		})();

		this.attachmentUploadCache.set(url, request);
		request.catch(() => {
			this.attachmentUploadCache.delete(url);
		});

		return request;
	}
}

/**
 * Walk a transcript recursively and collect the media URLs that would be sent
 * to the proxy service.
 */
export function collectTranscriptMediaUrls(messages: readonly DraftMessage[]): Set<string> {
	const urls = new Set<string>();
	const visited = new WeakSet<object>();

	const maybeAdd = (value: string | undefined): void => {
		if (!value) {
			return;
		}

		try {
			new URL(value);
			urls.add(value);
		} catch {
			// Skip invalid URLs so callers can still use the set size as progress.
		}
	};

	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item);
			}
			return;
		}

		if (!isRecord(value) || visited.has(value)) {
			return;
		}

		visited.add(value);

		const mediaSourceUrl = readTrimmedString(value, "proxy_url") ?? readTrimmedString(value, "url");
		if (mediaSourceUrl && isLikelyMediaObject(value)) {
			maybeAdd(mediaSourceUrl);
		}

		const iconSourceUrl = readTrimmedString(value, "proxy_icon_url") ?? readTrimmedString(value, "icon_url");
		if (iconSourceUrl) {
			maybeAdd(iconSourceUrl);
		}

		for (const nestedValue of Object.values(value)) {
			visit(nestedValue);
		}
	};

	for (const message of messages) {
		visit(message);
	}

	return urls;
}

/**
 * Upload all avatar hashes already present in `context.users` so the media API
 * can cache them, but keep `user.avatar` as the original Discord hash.
 *
 * The viewer still expects `user.avatar` to be a raw Discord avatar hash and
 * derives the final CDN URL from `user.id + user.avatar`. Replacing the field
 * with a proxy URL would make the serialized transcript incompatible with the
 * existing viewer contract.
 */
export async function proxyTranscriptAvatarsInPlace(
	users: Record<string, UserInfo>,
	client: TicketPmMediaProxyClient,
	options?: { onProgress?: UploadProgressCallback }
): Promise<void> {
	const uploads = Object.values(users)
		.filter((user) => isValidAvatarHash(user.avatar))
		.map((user) => ({ hash: user.avatar!.trim(), userId: user.id }));

	const total = uploads.length;
	let completed = 0;
	options?.onProgress?.(completed, total);

	for (const upload of uploads) {
		await client.uploadAvatarHash(upload.hash, upload.userId);

		completed += 1;
		options?.onProgress?.(completed, total);
	}
}

/**
 * Proxy the guild icon if one exists and mutate the guild object in place.
 */
export async function proxyGuildIconInPlace(guild: GuildInfo, client: TicketPmMediaProxyClient): Promise<string | undefined> {
	if (!isValidAvatarHash(guild.icon)) {
		return undefined;
	}

	const proxied = await client.uploadGuildIconHash(guild.icon.trim(), guild.id);
	if (proxied) {
		guild.proxy_icon_url = proxied;
	}

	return proxied;
}

function isAlreadyRewrittenAttachmentUrl(baseUrl: string, url: string): boolean {
	return url.startsWith(joinUrl(baseUrl, "/attachments/"));
}

async function rewriteMediaUrlFields(record: Record<string, unknown>, client: TicketPmMediaProxyClient): Promise<void> {
	const mediaSourceUrl = readTrimmedString(record, "proxy_url") ?? readTrimmedString(record, "url");
	if (mediaSourceUrl && isLikelyMediaObject(record) && !isAlreadyRewrittenAttachmentUrl(client.baseUrl, mediaSourceUrl)) {
		const proxiedUrl = await client.uploadAttachmentUrl(mediaSourceUrl);
		if (proxiedUrl) {
			record.proxy_url = proxiedUrl;
		}
	}

	const iconSourceUrl = readTrimmedString(record, "proxy_icon_url") ?? readTrimmedString(record, "icon_url");
	if (iconSourceUrl && !isAlreadyRewrittenAttachmentUrl(client.baseUrl, iconSourceUrl)) {
		const proxiedIconUrl = await client.uploadAttachmentUrl(iconSourceUrl);
		if (proxiedIconUrl) {
			record.proxy_icon_url = proxiedIconUrl;
		}
	}
}

/**
 * Rewrite nested media-bearing fields to prefer the ticket.pm proxy service.
 *
 * Failure behavior:
 *
 * - successful proxy uploads write `proxy_url` or `proxy_icon_url`
 * - failed proxy uploads leave existing fields unchanged
 * - original Discord-hosted media URLs remain available as fallback
 */
export async function rewriteTranscriptMediaUrlsInPlace(
	messages: DraftMessage[],
	client: TicketPmMediaProxyClient,
	options?: { onProgress?: UploadProgressCallback; expectedUrls?: Set<string> }
): Promise<void> {
	const visited = new WeakSet<object>();
	const expectedUrls = options?.expectedUrls ?? collectTranscriptMediaUrls(messages);
	const total = expectedUrls.size;
	let completed = 0;
	options?.onProgress?.(completed, total);

	const visit = async (value: unknown): Promise<void> => {
		if (Array.isArray(value)) {
			for (const item of value) {
				await visit(item);
			}
			return;
		}

		if (!isRecord(value) || visited.has(value)) {
			return;
		}

		visited.add(value);

		const mediaSourceUrl = readTrimmedString(value, "proxy_url") ?? readTrimmedString(value, "url");
		if (mediaSourceUrl && expectedUrls.delete(mediaSourceUrl)) {
			completed += 1;
			options?.onProgress?.(completed, total);
		}

		await rewriteMediaUrlFields(value, client);

		for (const nestedValue of Object.values(value)) {
			await visit(nestedValue);
		}
	};

	for (const message of messages) {
		await visit(message);
	}
}

/**
 * Convenience wrapper for callers that keep the whole transcript structure
 * together while proxying assets.
 *
 * This helper is best-effort. Media proxy failures do not throw away the
 * original transcript media fields; they simply leave them as they were.
 */
export async function proxyTranscriptAssetsInPlace(
	transcript: { messages: DraftMessage[]; context: DiscordContext },
	client: TicketPmMediaProxyClient,
	options?: {
		avatarProgress?: UploadProgressCallback;
		mediaProgress?: UploadProgressCallback;
	}
): Promise<void> {
	if (transcript.context.users) {
		await proxyTranscriptAvatarsInPlace(transcript.context.users, client, {
			onProgress: options?.avatarProgress
		});
	}

	if (transcript.context.guild) {
		await proxyGuildIconInPlace(transcript.context.guild, client);
	}

	await rewriteTranscriptMediaUrlsInPlace(transcript.messages, client, {
		onProgress: options?.mediaProgress
	});
}
