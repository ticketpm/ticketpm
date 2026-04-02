/**
 * Shared constants copied from the current ticket.pm API contract so that
 * package consumers can validate payloads before hitting the network.
 */
export const MAX_TRANSCRIPT_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_TRANSCRIPT_DECOMPRESSED_BYTES = 128 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHANNEL_NAME_CHARACTERS = 100;
export const MAX_TRANSCRIPT_NESTING_DEPTH = 20;
export const DEFAULT_TRANSCRIPT_COMPRESSION_LEVEL = 15;
export const DEFAULT_TICKETPM_MEDIA_PROXY_BASE_URL = "https://m.ticket.pm/v2";
