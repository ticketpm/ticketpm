import type { UserInfo } from "./types.js";

export type IdentityUser = Pick<UserInfo, "bot" | "public_flags" | "username"> & {
	discriminator?: string | null;
};

export interface WebhookAuthorOptions {
	isWebhook?: boolean;
	isInteractionResponse?: boolean;
	/**
	 * @deprecated Application-owned channel webhooks also set `application_id`.
	 * Use `isInteractionResponse` to distinguish interaction responses instead.
	 */
	applicationId?: string | null;
}

/**
 * Discord marks verified bots with the public flag bit `1 << 16`.
 */
export function isVerifiedBot(user: Pick<UserInfo, "bot" | "public_flags">): boolean {
	if (!user.bot) {
		return false;
	}

	const flags = user.public_flags ?? 0;
	return (flags & (1 << 16)) === 1 << 16;
}

/**
 * The first-party exporter distinguishes ordinary bot users from webhook
 * authors because webhooks do not have a stable application identity.
 */
export function isWebhookAuthor(_user: Pick<UserInfo, "bot" | "public_flags">, options?: WebhookAuthorOptions): boolean {
	// Discord documents `webhook_id` as the authoritative signal. An
	// `application_id` is not sufficient to reject a webhook because channel
	// webhooks can be application-owned too.
	return Boolean(options?.isWebhook && !options.isInteractionResponse);
}

/**
 * The viewer wants canonical usernames for real users, but bot-like identities
 * keep a `name#discriminator` shape so they stay visually distinguishable.
 */
export function formatExportUsername(user: IdentityUser, options?: { webhook?: boolean }): string {
	if (!user.bot && !options?.webhook) {
		return user.username;
	}

	if (user.username.includes("#")) {
		return user.username;
	}

	const discriminator = user.discriminator && user.discriminator.length > 0 ? user.discriminator : "0000";
	return `${user.username}#${discriminator}`;
}
