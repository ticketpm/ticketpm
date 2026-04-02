export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTrimmedString(record: UnknownRecord, key: string): string | undefined {
	const value = record[key];
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function sortRecordByKey<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
	if (!record) {
		return undefined;
	}

	return Object.keys(record)
		.sort()
		.reduce<Record<string, T>>((accumulator, key) => {
			const value = record[key];
			if (value !== undefined) {
				accumulator[key] = value;
			}
			return accumulator;
		}, {});
}

export function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

// Ensure the endpoint joining works as intended without duping slashes
export function joinUrl(baseUrl: string, path: string): string {
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedBaseUrl}${normalizedPath}`;
}
