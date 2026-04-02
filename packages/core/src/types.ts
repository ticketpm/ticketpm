/**
 * The transcript model intentionally mirrors the compact storage format that
 * ticket.pm persists and hydrates in the viewer. Library-specific adapters are
 * expected to normalize their source data into the richer draft message shape
 * below before the core package compacts it.
 */

export type ChannelType = "text" | "thread" | "voice" | "stage";

export enum MessageType {
	Default = 0,
	RecipientAdd = 1,
	RecipientRemove = 2,
	Call = 3,
	ChannelNameChange = 4,
	ChannelIconChange = 5,
	ChannelPinnedMessage = 6,
	UserJoin = 7,
	GuildBoost = 8,
	GuildBoostTier1 = 9,
	GuildBoostTier2 = 10,
	GuildBoostTier3 = 11,
	ChannelFollowAdd = 12,
	GuildDiscoveryDisqualified = 14,
	GuildDiscoveryRequalified = 15,
	GuildDiscoveryGracePeriodInitialWarning = 16,
	GuildDiscoveryGracePeriodFinalWarning = 17,
	ThreadCreated = 18,
	Reply = 19,
	ChatInputCommand = 20,
	ThreadStarterMessage = 21,
	GuildInviteReminder = 22,
	ContextMenuCommand = 23,
	AutoModerationAction = 24,
	RoleSubscriptionPurchase = 25,
	InteractionPremiumUpsell = 26,
	StageStart = 27,
	StageEnd = 28,
	StageSpeaker = 29,
	StageRaiseHand = 30,
	StageTopic = 31,
	GuildApplicationPremiumSubscription = 32,
	PollResult = 46
}

export interface ChannelInfo {
	name: string;
	type?: ChannelType;
	parent_id?: string;
}

export interface RoleInfo {
	name: string;
	color?: string;
	position?: number;
}

export interface MemberInfo {
	roles: string[];
}

export interface GuildInfo {
	id: string;
	name: string;
	icon?: string | null;
	icon_url?: string | null;
	proxy_icon_url?: string | null;
	approximate_member_count?: number;
	owner_id?: string;
	vanity_url_code?: string | null;
}

export interface APIUserPrimaryGuild {
	tag: string;
	identity_guild_id: string;
	identity_enabled: boolean;
	badge: string;
}

export interface UserInfo {
	id: string;
	username: string;
	display_name?: string | null;
	global_name?: string | null;
	avatar?: string | null;
	bot?: boolean;
	webhook?: boolean;
	public_flags?: number;
	avatar_decoration_data?: {
		asset: string;
		sku_id?: string;
	} | null;
	primary_guild?: APIUserPrimaryGuild | null;
}

export interface DiscordContext {
	channel_id?: string;
	channels?: Record<string, ChannelInfo>;
	roles?: Record<string, RoleInfo>;
	users?: Record<string, UserInfo>;
	members?: Record<string, MemberInfo>;
	guild?: GuildInfo;
}

export interface APIEmbedAuthor {
	name: string;
	url?: string;
	icon_url?: string;
	proxy_icon_url?: string;
}

export interface APIEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface APIEmbedFooter {
	text: string;
	icon_url?: string;
	proxy_icon_url?: string;
}

export interface APIEmbedImage {
	url: string;
	proxy_url?: string;
	width?: number;
	height?: number;
	content_type?: string;
}

export interface APIEmbedThumbnail {
	url: string;
	proxy_url?: string;
	width?: number;
	height?: number;
}

export interface APIEmbedVideo {
	url?: string;
	proxy_url?: string;
	width?: number;
	height?: number;
	content_type?: string;
}

export interface APIEmbed {
	title?: string;
	type?: string;
	description?: string;
	url?: string;
	timestamp?: string;
	color?: number;
	footer?: APIEmbedFooter;
	image?: APIEmbedImage;
	thumbnail?: APIEmbedThumbnail;
	author?: APIEmbedAuthor;
	fields?: APIEmbedField[];
	video?: APIEmbedVideo;
}

export enum ComponentType {
	ActionRow = 1,
	Button = 2,
	StringSelect = 3,
	TextInput = 4,
	UserSelect = 5,
	RoleSelect = 6,
	MentionableSelect = 7,
	ChannelSelect = 8,
	Section = 9,
	TextDisplay = 10,
	Thumbnail = 11,
	MediaGallery = 12,
	File = 13,
	Separator = 14,
	Container = 17
}

export enum ButtonStyle {
	Primary = 1,
	Secondary = 2,
	Success = 3,
	Danger = 4,
	Link = 5,
	Premium = 6
}

export enum SeparatorSpacing {
	Small = 1,
	Large = 2
}

export interface ComponentEmoji {
	id?: string;
	name?: string;
	animated?: boolean;
}

export interface UnfurledMediaItem {
	url: string;
	proxy_url?: string;
	height?: number | null;
	width?: number | null;
	content_type?: string;
}

export interface ButtonComponent {
	type: ComponentType.Button;
	id?: number;
	style: ButtonStyle;
	label?: string;
	emoji?: ComponentEmoji;
	custom_id?: string;
	sku_id?: string;
	url?: string;
	disabled?: boolean;
}

export interface SelectMenuOption {
	label: string;
	value: string;
	description?: string;
	emoji?: ComponentEmoji;
	default?: boolean;
}

export interface StringSelectComponent {
	type: ComponentType.StringSelect;
	id?: number;
	custom_id: string;
	options: SelectMenuOption[];
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
}

export interface UserSelectComponent {
	type: ComponentType.UserSelect;
	id?: number;
	custom_id: string;
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
}

export interface RoleSelectComponent {
	type: ComponentType.RoleSelect;
	id?: number;
	custom_id: string;
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
}

export interface MentionableSelectComponent {
	type: ComponentType.MentionableSelect;
	id?: number;
	custom_id: string;
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
}

export interface ChannelSelectComponent {
	type: ComponentType.ChannelSelect;
	id?: number;
	custom_id: string;
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
}

export type SelectMenuComponent =
	| StringSelectComponent
	| UserSelectComponent
	| RoleSelectComponent
	| MentionableSelectComponent
	| ChannelSelectComponent;

export interface ActionRowComponent {
	type: ComponentType.ActionRow;
	id?: number;
	components: (ButtonComponent | SelectMenuComponent)[];
}

export interface TextDisplayComponent {
	type: ComponentType.TextDisplay;
	id?: number;
	content: string;
}

export interface ThumbnailComponent {
	type: ComponentType.Thumbnail;
	id?: number;
	media: UnfurledMediaItem;
	description?: string | null;
	spoiler?: boolean;
}

export interface MediaGalleryItem {
	media: UnfurledMediaItem;
	description?: string | null;
	spoiler?: boolean;
}

export interface MediaGalleryComponent {
	type: ComponentType.MediaGallery;
	id?: number;
	items: MediaGalleryItem[];
}

export interface FileComponent {
	type: ComponentType.File;
	id?: number;
	file: UnfurledMediaItem;
	spoiler?: boolean;
	name?: string;
	size?: number;
}

export interface SeparatorComponent {
	type: ComponentType.Separator;
	id?: number;
	divider?: boolean;
	spacing?: SeparatorSpacing;
}

export interface SectionComponent {
	type: ComponentType.Section;
	id?: number;
	components: TextDisplayComponent[];
	accessory: ButtonComponent | ThumbnailComponent;
}

export type ContainerChildComponent =
	| ActionRowComponent
	| TextDisplayComponent
	| SectionComponent
	| MediaGalleryComponent
	| SeparatorComponent
	| FileComponent;

export interface ContainerComponent {
	type: ComponentType.Container;
	id?: number;
	components: ContainerChildComponent[];
	accent_color?: number | null;
	spoiler?: boolean;
}

export type MessageTopLevelComponent =
	| ActionRowComponent
	| ContainerComponent
	| FileComponent
	| MediaGalleryComponent
	| SectionComponent
	| SeparatorComponent
	| TextDisplayComponent;

export interface APIPartialEmoji {
	id?: string | null;
	name?: string | null;
	animated?: boolean;
}

export interface APIReactionCountDetails {
	burst: number;
	normal: number;
}

export interface APIReaction {
	count: number;
	count_details: APIReactionCountDetails;
	me: boolean;
	me_burst: boolean;
	emoji: APIPartialEmoji;
	burst_colors: string[];
}

export enum StickerFormatType {
	PNG = 1,
	APNG = 2,
	Lottie = 3,
	GIF = 4
}

export interface APIStickerItem {
	id: string;
	name: string;
	format_type: StickerFormatType;
}

export enum PollLayoutType {
	Default = 1
}

export interface APIPollMedia {
	text?: string;
	emoji?: APIPartialEmoji;
}

export interface APIPollAnswer {
	answer_id: number;
	poll_media: APIPollMedia;
}

export interface APIPollAnswerCount {
	id: number;
	count: number;
	me_voted: boolean;
}

export interface APIPollResults {
	is_finalized: boolean;
	answer_counts: APIPollAnswerCount[];
}

export interface APIPollVoter extends UserInfo {}

export interface APIPoll {
	question: APIPollMedia;
	answers: APIPollAnswer[];
	expiry: string;
	allow_multiselect: boolean;
	layout_type: PollLayoutType;
	results?: APIPollResults;
	answer_voters?: Record<number, APIPollVoter[]>;
	answer_voter_ids?: Record<number, string[]>;
}

export interface APIAttachment {
	id: string;
	filename: string;
	size: number;
	url: string;
	proxy_url?: string;
	content_type?: string;
	width?: number | null;
	height?: number | null;
	render_hint?: "gifv";
	poster_url?: string;
	poster_proxy_url?: string;
}

export enum InteractionType {
	Ping = 1,
	ApplicationCommand = 2,
	MessageComponent = 3,
	ApplicationCommandAutocomplete = 4,
	ModalSubmit = 5
}

export interface APIInteractionUser extends UserInfo {}

export interface DraftMessageInteractionMetadata {
	id: string;
	type: InteractionType | number;
	user: APIInteractionUser;
	name?: string;
	original_response_message_id?: string;
	triggering_interaction_metadata?: DraftMessageInteractionMetadata;
}

export interface CompactMessageInteractionMetadata {
	id: string;
	type: InteractionType | number;
	user_id: string;
	name?: string;
	original_response_message_id?: string;
	triggering_interaction_metadata?: CompactMessageInteractionMetadata;
}

export interface DraftMessageInteraction {
	id: string;
	type: InteractionType | number;
	name: string;
	user: APIInteractionUser;
}

export interface CompactMessageInteraction {
	id: string;
	type: InteractionType | number;
	name: string;
	user_id: string;
}

export interface MessageReference {
	message_id?: string;
	channel_id?: string;
	guild_id?: string;
	type?: number;
}

export interface DraftMessageSnapshot {
	message: {
		content: string;
		mention_everyone?: boolean;
		embeds?: APIEmbed[];
		attachments?: APIAttachment[];
		sticker_items?: APIStickerItem[];
		components?: MessageTopLevelComponent[];
		poll?: APIPoll;
		type?: number;
		flags?: number;
	};
}

export interface DraftMessage {
	id: string;
	type?: number;
	content?: string;
	channel_id?: string;
	author?: UserInfo;
	timestamp?: string;
	edited_timestamp?: string | null;
	mention_everyone?: boolean;
	mentions?: UserInfo[];
	mention_roles?: string[];
	attachments?: APIAttachment[];
	embeds?: APIEmbed[];
	reactions?: APIReaction[];
	components?: MessageTopLevelComponent[];
	sticker_items?: APIStickerItem[];
	referenced_message?: DraftMessage | null;
	message_reference?: MessageReference | null;
	interaction_metadata?: DraftMessageInteractionMetadata | null;
	interaction?: DraftMessageInteraction | null;
	poll?: APIPoll;
	message_snapshots?: DraftMessageSnapshot[];
}

export interface CompactReferencedMessage {
	id: string;
	type?: number;
	mention_everyone?: boolean;
	author_id?: string;
	content?: string;
	interaction?: Pick<CompactMessageInteraction, "type">;
	interaction_metadata?: Pick<CompactMessageInteractionMetadata, "type">;
	embeds?: APIEmbed[];
	attachments?: APIAttachment[];
	sticker_items?: APIStickerItem[];
}

export interface StoredCompactMessage {
	id: string;
	type?: number;
	timestamp?: string;
	author_id?: string;
	content?: string;
	mention_everyone?: boolean;
	edited_timestamp?: string | null;
	attachments?: APIAttachment[];
	embeds?: APIEmbed[];
	reactions?: APIReaction[];
	components?: MessageTopLevelComponent[];
	sticker_items?: APIStickerItem[];
	poll?: APIPoll;
	interaction_metadata?: CompactMessageInteractionMetadata;
	interaction?: CompactMessageInteraction;
	message_reference?: MessageReference | null;
	message_snapshots?: DraftMessageSnapshot[];
	referenced_message?: CompactReferencedMessage | null;
	mention_ids?: string[];
	mention_roles?: string[];
}

export interface StoredTranscript {
	messages: StoredCompactMessage[];
	context?: DiscordContext;
}

export interface TranscriptBuildInput {
	messages: DraftMessage[];
	context: DiscordContext;
}

export interface UploadValidationIssue {
	path: string;
	message: string;
}

export interface UploadValidationResult {
	ok: boolean;
	errors: UploadValidationIssue[];
}
