import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	vi.doUnmock("node:zlib");
});

describe("@ticketpm/core runtime", () => {
	it("prefers Bun compression when running on Bun", async () => {
		const bunCompress = vi.spyOn(Bun, "zstdCompress").mockResolvedValue(Buffer.from([7, 8, 9]));
		vi.doMock("node:zlib", () => ({
			zstdCompress: vi.fn((_input, _options, callback: (error?: Error | null, result?: Uint8Array) => void) => {
				callback(new Error("node:zlib fallback should not run when Bun is available"));
			})
		}));

		const { compressBytesZstd, isRunningOnBun } = await import("../src/index.js");
		const result = await compressBytesZstd(new Uint8Array([1, 2, 3]), {
			level: 7
		});

		expect(isRunningOnBun()).toBe(true);
		expect(Array.from(result)).toEqual([7, 8, 9]);
		expect(bunCompress).toHaveBeenCalledWith(expect.any(Uint8Array), {
			level: 7
		});
	});

	it("falls back to node:zlib when Bun is not available", async () => {
		const nodeZstdCompress = vi.fn(
			(_input: Uint8Array, _options: { level?: number } | undefined, callback: (error: null, result: Buffer) => void) => {
				callback(null, Buffer.from([9, 8, 7]));
			}
		);

		vi.doMock("node:zlib", () => ({
			zstdCompress: nodeZstdCompress
		}));

		const { compressBytesZstd, isRunningOnBun } = await import("../src/index.js");
		const result = await compressBytesZstd(new Uint8Array([4, 5, 6]), {
			level: 4,
			runtime: "node"
		});

		expect(isRunningOnBun()).toBe(true);
		expect(result).toBeInstanceOf(Uint8Array);
		expect(Array.from(result)).toEqual([9, 8, 7]);
		expect(nodeZstdCompress).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			{
				level: 4,
				runtime: "node"
			},
			expect.any(Function)
		);
	});
});
