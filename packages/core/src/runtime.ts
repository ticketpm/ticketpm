import { promisify } from "node:util";

import { toUint8Array } from "./utils.js";

type ZstdCompressOptions = {
	level?: number;
	runtime?: "auto" | "bun" | "node";
};

type BunLike = {
	zstdCompress(bytes: Uint8Array, options?: ZstdCompressOptions): Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;
};

type NodeZstdCompress = (bytes: Uint8Array, options?: ZstdCompressOptions) => Promise<Uint8Array>;

let nodeZstdCompressPromise: Promise<NodeZstdCompress> | undefined;

export function getBunRuntime(): BunLike | undefined {
	const maybeBun = (globalThis as { Bun?: unknown }).Bun;
	if (
		typeof maybeBun === "object" &&
		maybeBun !== null &&
		"zstdCompress" in maybeBun &&
		typeof maybeBun.zstdCompress === "function"
	) {
		return maybeBun as BunLike;
	}

	return undefined;
}

export function isRunningOnBun(): boolean {
	return getBunRuntime() !== undefined;
}

async function getNodeZstdCompress(): Promise<NodeZstdCompress> {
	if (!nodeZstdCompressPromise) {
		nodeZstdCompressPromise = (async () => {
			const { zstdCompress } = await import("node:zlib");
			// Polyfill node versions without zstd
			if (typeof zstdCompress !== "function") {
				throw new Error(
					"Node.js runtime does not expose zstd compression. Use Bun or a Node.js version with node:zlib zstd support."
				);
			}
			const zstdCompressAsync = promisify(zstdCompress);

			return async (bytes: Uint8Array, options?: ZstdCompressOptions): Promise<Uint8Array> => {
				const compressed = await zstdCompressAsync(bytes, options as never);
				return toUint8Array(compressed);
			};
		})();
	}

	return nodeZstdCompressPromise;
}

// Bun is much faster for this native zstd path, otherwise fallback to standard Node zlib
export async function compressWithRuntimeZstd(bytes: Uint8Array, options?: ZstdCompressOptions): Promise<Uint8Array> {
	const runtime = options?.runtime ?? "auto";
	const bun = getBunRuntime();

	if (runtime !== "node" && bun) {
		const compressed = await bun.zstdCompress(bytes, options);
		return toUint8Array(compressed);
	}

	if (runtime === "bun") {
		throw new Error("Bun runtime was requested for ZSTD compression, but Bun is not available.");
	}

	const nodeZstdCompress = await getNodeZstdCompress();
	return nodeZstdCompress(bytes, options);
}
