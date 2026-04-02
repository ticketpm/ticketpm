import { DEFAULT_TRANSCRIPT_COMPRESSION_LEVEL } from "./constants.js";
import { compressWithRuntimeZstd } from "./runtime.js";
import type { StoredTranscript } from "./types.js";
import { isRecord } from "./utils.js";

function sortValueForCanonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValueForCanonicalJson);
	}

	if (!isRecord(value)) {
		return value;
	}

	return Object.keys(value)
		.sort()
		.reduce<Record<string, unknown>>((accumulator, key) => {
			const child = value[key];
			if (child !== undefined) {
				accumulator[key] = sortValueForCanonicalJson(child);
			}
			return accumulator;
		}, {});
}

/**
 * Create a whitespace-free JSON string with deterministic key ordering so
 * ticket.pm dedupe matches semantic intent as closely as possible.
 */
export function stringifyCanonicalJson(value: unknown): string {
	return JSON.stringify(sortValueForCanonicalJson(value));
}

/**
 * Serialize a transcript into the exact byte stream that should be compressed
 * and uploaded.
 */
export function serializeStoredTranscript(transcript: StoredTranscript): Uint8Array {
	return new TextEncoder().encode(stringifyCanonicalJson(transcript));
}

/**
 * ticket.pm expects ZSTD-compressed bytes. Bun is preferred when available,
 * while Node.js falls back to `node:zlib`.
 */
export async function compressBytesZstd(
	bytes: Uint8Array,
	options?: { level?: number; runtime?: "auto" | "bun" | "node" }
): Promise<Uint8Array> {
	return compressWithRuntimeZstd(bytes, {
		level: options?.level ?? DEFAULT_TRANSCRIPT_COMPRESSION_LEVEL,
		runtime: options?.runtime
	});
}

/**
 * Canonicalize and compress a transcript in one step.
 */
export async function compressStoredTranscript(transcript: StoredTranscript, options?: { level?: number }): Promise<Uint8Array> {
	return compressBytesZstd(serializeStoredTranscript(transcript), options);
}
