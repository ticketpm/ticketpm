import { compressStoredTranscript } from "./canonical.js";
import { buildStoredTranscript } from "./compact.js";
import {
	DEFAULT_TICKETPM_MEDIA_PROXY_BASE_URL,
	MAX_TRANSCRIPT_COMPRESSED_BYTES,
	MAX_TRANSCRIPT_DECOMPRESSED_BYTES
} from "./constants.js";
import {
	proxyTranscriptAssetsInPlace,
	TicketPmMediaProxyClient,
	type TicketPmMediaProxyClientOptions,
	type UploadProgressCallback
} from "./media-proxy.js";
import type { StoredTranscript, TranscriptBuildInput } from "./types.js";
import { joinUrl } from "./utils.js";

export interface TicketPmUploadClientOptions {
	/**
	 * Base transcript API URL, for example `https://ticket.pm/v2`.
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
	/**
	 * Base URL used when `uploadDraftTranscript()` auto-creates a media proxy
	 * client for you.
	 *
	 * Defaults to `https://m.ticket.pm/v2`.
	 */
	defaultMediaProxyBaseUrl?: string;
}

export interface UploadCompressedTranscriptOptions {
	/**
	 * Match the current first-party bot behavior of requesting URL-safe random IDs
	 * via `?uuid=uuid`.
	 */
	uuidStyleIds?: boolean;
}

export type UploadDraftTranscriptMediaProxy =
	| false
	| TicketPmMediaProxyClient
	| Partial<Pick<TicketPmMediaProxyClientOptions, "baseUrl" | "token" | "fetch">>;

export interface UploadDraftTranscriptOptions extends UploadCompressedTranscriptOptions {
	/**
	 * Optional ZSTD compression level forwarded to `compressStoredTranscript()`.
	 */
	level?: number;
	/**
	 * Media proxy configuration for draft uploads.
	 *
	 * - omit this value to auto-create a proxy client with the uploader token and
	 *   `https://m.ticket.pm/v2`
	 * - pass an existing `TicketPmMediaProxyClient` to fully control media proxy
	 *   behavior
	 * - pass a partial options object to override only `baseUrl`, `token`, and/or
	 *   `fetch`
	 * - pass `false` to disable media proxying entirely for this upload
	 */
	mediaProxy?: UploadDraftTranscriptMediaProxy;
	/**
	 * Optional progress callback for avatar cache uploads performed before the
	 * transcript is built.
	 */
	avatarProgress?: UploadProgressCallback;
	/**
	 * Optional progress callback for attachment/embed/icon proxy rewrites
	 * performed before the transcript is built.
	 */
	mediaProgress?: UploadProgressCallback;
}

export interface TicketPmUploadResult {
	id: string;
	rateLimitRemaining?: number;
	rateLimitReset?: number;
}

function buildUploadHeaders(token?: string): HeadersInit {
	const headers = new Headers({ "Content-Type": "application/octet-stream" });
	if (token) {
		headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
	}
	return headers;
}

/**
 * Minimal upload client for `POST /v2/upload`.
 */
export class TicketPmUploadClient {
	private readonly fetchImpl: typeof fetch;

	public constructor(private readonly options: TicketPmUploadClientOptions) {
		this.fetchImpl = options.fetch ?? fetch;
	}

	public async uploadCompressedTranscript(
		compressed: Uint8Array,
		options?: UploadCompressedTranscriptOptions
	): Promise<TicketPmUploadResult> {
		if (compressed.byteLength > MAX_TRANSCRIPT_COMPRESSED_BYTES) {
			throw new Error(`Compressed transcript exceeds ${MAX_TRANSCRIPT_COMPRESSED_BYTES} bytes.`);
		}

		const uploadUrl = new URL(joinUrl(this.options.baseUrl, "/upload"));
		if (options?.uuidStyleIds !== false) {
			uploadUrl.searchParams.set("uuid", "uuid");
		}

		const response = await this.fetchImpl(uploadUrl, {
			method: "POST",
			headers: buildUploadHeaders(this.options.token),
			body: Buffer.from(compressed)
		});

		if (!response.ok) {
			throw new Error(await response.text());
		}

		const payload = (await response.json()) as { id?: unknown };
		if (typeof payload.id !== "string" || payload.id.length === 0) {
			throw new Error("ticket.pm upload completed without returning a transcript id.");
		}

		return {
			id: payload.id,
			rateLimitRemaining: readNumericHeader(response.headers, "X-RateLimit-Remaining"),
			rateLimitReset: readNumericHeader(response.headers, "X-RateLimit-Reset")
		};
	}

	public async uploadTranscript(
		transcript: StoredTranscript,
		options?: UploadCompressedTranscriptOptions & { level?: number }
	): Promise<TicketPmUploadResult> {
		const compressed = await compressStoredTranscript(transcript, {
			level: options?.level
		});
		return this.uploadCompressedTranscript(compressed, options);
	}

	/**
	 * High-level draft upload helper.
	 *
	 * This clones the draft transcript, proxies assets when enabled, compacts the
	 * draft into the stored transcript contract, compresses it, and uploads it.
	 *
	 * When `options.mediaProxy` is omitted, the client auto-creates a
	 * `TicketPmMediaProxyClient` using:
	 *
	 * - `baseUrl`: `options.defaultMediaProxyBaseUrl ?? https://m.ticket.pm/v2`
	 * - `token`: the uploader token
	 * - `fetch`: the uploader fetch implementation
	 *
	 * Pass `mediaProxy: false` to skip proxying and upload the original media
	 * fields unchanged.
	 */
	public async uploadDraftTranscript(
		draftTranscript: TranscriptBuildInput,
		options?: UploadDraftTranscriptOptions
	): Promise<TicketPmUploadResult> {
		const workingDraft = cloneTranscriptBuildInput(draftTranscript);
		const mediaProxyClient = this.resolveMediaProxyClient(options?.mediaProxy);

		if (mediaProxyClient) {
			await proxyTranscriptAssetsInPlace(workingDraft, mediaProxyClient, {
				avatarProgress: options?.avatarProgress,
				mediaProgress: options?.mediaProgress
			});
		}

		const transcript = buildStoredTranscript(workingDraft);
		return this.uploadTranscript(transcript, options);
	}

	private resolveMediaProxyClient(mediaProxy: UploadDraftTranscriptMediaProxy | undefined): TicketPmMediaProxyClient | undefined {
		if (mediaProxy === false) {
			return undefined;
		}

		if (mediaProxy instanceof TicketPmMediaProxyClient) {
			return mediaProxy;
		}

		return new TicketPmMediaProxyClient({
			baseUrl: mediaProxy?.baseUrl ?? this.options.defaultMediaProxyBaseUrl ?? DEFAULT_TICKETPM_MEDIA_PROXY_BASE_URL,
			token: mediaProxy?.token ?? this.options.token,
			fetch: mediaProxy?.fetch ?? this.fetchImpl
		});
	}
}

function cloneTranscriptBuildInput(draftTranscript: TranscriptBuildInput): TranscriptBuildInput {
	if (typeof structuredClone === "function") {
		return structuredClone(draftTranscript);
	}

	return {
		context: JSON.parse(JSON.stringify(draftTranscript.context)) as TranscriptBuildInput["context"],
		messages: JSON.parse(JSON.stringify(draftTranscript.messages)) as TranscriptBuildInput["messages"]
	};
}

function readNumericHeader(headers: Headers, key: string): number | undefined {
	const value = headers.get(key);
	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export { MAX_TRANSCRIPT_COMPRESSED_BYTES, MAX_TRANSCRIPT_DECOMPRESSED_BYTES };
