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

	it("normalizes ArrayBuffer results returned by Bun compression", async () => {
		const bunCompress = vi
			.spyOn(Bun, "zstdCompress")
			// @ts-expect-error Bun's type narrows the return value more than the runtime helper accepts.
			.mockImplementation(async () => Uint8Array.from([5, 4, 3]).buffer as unknown as Uint8Array);

		const { compressBytesZstd } = await import("../src/index.js");
		const result = await compressBytesZstd(new Uint8Array([1, 2, 3]));

		expect(result).toBeInstanceOf(Uint8Array);
		expect(Array.from(result)).toEqual([5, 4, 3]);
		expect(bunCompress).toHaveBeenCalledWith(expect.any(Uint8Array), {
			level: 15,
			runtime: undefined
		});
	});

	it("rejects when node:zlib compression fails", async () => {
		vi.doMock("node:zlib", () => ({
			zstdCompress: vi.fn((_input: Uint8Array, _options: { level?: number } | undefined, callback: (error: Error) => void) => {
				callback(new Error("node zstd failed"));
			})
		}));

		const { compressBytesZstd } = await import("../src/index.js");

		await expect(
			compressBytesZstd(new Uint8Array([1, 2, 3]), {
				runtime: "node"
			})
		).rejects.toThrow("node zstd failed");
	});
});
