import type {
	ActionRowComponent,
	APIEmbed,
	APIPoll,
	ButtonComponent,
	CensoredTextRange,
	ContainerChildComponent,
	DiscordContext,
	DraftMessageSnapshot,
	MediaGalleryComponent,
	MessageTopLevelComponent,
	SectionComponent,
	SelectMenuComponent,
	StoredCompactMessage,
	StoredTranscript,
	StringSelectComponent,
	ThumbnailComponent,
	TranscriptCensorshipOptions
} from "./types.js";
import { ComponentType } from "./types.js";

const CENSOR_CHARACTER = "•";
const MINIMUM_CENSORED_WORD_CHARACTERS = 3;

interface CensorTerm {
	expression: RegExp;
	order: number;
}

interface CensorMatch {
	characterLength: number;
	end: number;
	order: number;
	start: number;
}

interface TextRange {
	end: number;
	start: number;
}

interface CensoredTextResult {
	ranges: TextRange[];
	value: string;
}

function escapeRegularExpression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCensorTerms(words: readonly string[] | undefined): CensorTerm[] {
	if (!words?.length) {
		return [];
	}

	const termsByFoldedValue = new Map<string, CensorTerm>();
	for (const [order, value] of words.entries()) {
		if (typeof value !== "string") {
			throw new TypeError("Each censored word must be a string.");
		}

		const characterLength = Array.from(value).length;
		if (characterLength < MINIMUM_CENSORED_WORD_CHARACTERS) {
			throw new RangeError(`Censored words must contain at least ${MINIMUM_CENSORED_WORD_CHARACTERS} Unicode characters.`);
		}

		const foldedValue = value.toLowerCase();
		if (!termsByFoldedValue.has(foldedValue)) {
			termsByFoldedValue.set(foldedValue, {
				// The lookahead discovers overlapping literal matches. Compiling it once
				// avoids rebuilding the same expression for every censored text field.
				expression: new RegExp(`(?=(${escapeRegularExpression(value)}))`, "giu"),
				order
			});
		}
	}

	return [...termsByFoldedValue.values()];
}

function findCensorMatches(value: string, terms: readonly CensorTerm[]): CensorMatch[] {
	const matches: CensorMatch[] = [];

	for (const term of terms) {
		for (const match of value.matchAll(term.expression)) {
			const matchedValue = match[1];
			if (match.index === undefined || matchedValue === undefined) {
				continue;
			}

			matches.push({
				start: match.index,
				end: match.index + matchedValue.length,
				characterLength: Array.from(matchedValue).length,
				order: term.order
			});
		}
	}

	matches.sort(
		(left, right) => left.start - right.start || right.characterLength - left.characterLength || left.order - right.order
	);

	const selected: CensorMatch[] = [];
	let selectedEnd = -1;
	for (const match of matches) {
		if (match.start < selectedEnd) {
			continue;
		}

		selected.push(match);
		selectedEnd = match.end;
	}

	return selected;
}

function maskMatchedValue(value: string): string {
	const characters = Array.from(value);
	const hidden = Math.min(characters.length - 2, Math.round(characters.length * 0.7));
	const visible = characters.length - hidden;
	const visibleStart = Math.ceil(visible / 2);
	const visibleEnd = Math.floor(visible / 2);

	return (
		characters.slice(0, visibleStart).join("") +
		CENSOR_CHARACTER.repeat(hidden) +
		characters.slice(characters.length - visibleEnd).join("")
	);
}

function censorText(value: string, terms: readonly CensorTerm[]): CensoredTextResult {
	const matches = findCensorMatches(value, terms);
	if (matches.length === 0) {
		return { value, ranges: [] };
	}

	let sourceOffset = 0;
	let censoredValue = "";
	const ranges: TextRange[] = [];

	for (const match of matches) {
		censoredValue += value.slice(sourceOffset, match.start);
		const maskedValue = maskMatchedValue(value.slice(match.start, match.end));
		const start = censoredValue.length;
		censoredValue += maskedValue;
		ranges.push({ start, end: censoredValue.length });
		sourceOffset = match.end;
	}

	censoredValue += value.slice(sourceOffset);
	return { value: censoredValue, ranges };
}

function censorRequiredText(value: string, path: string, terms: readonly CensorTerm[], ranges: CensoredTextRange[]): string {
	const result = censorText(value, terms);
	for (const range of result.ranges) {
		ranges.push({ path, ...range });
	}
	return result.value;
}

function censorOptionalText(
	value: string | null | undefined,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): string | null | undefined {
	return typeof value === "string" ? censorRequiredText(value, path, terms, ranges) : value;
}

function censorEmbed(embed: APIEmbed, path: string, terms: readonly CensorTerm[], ranges: CensoredTextRange[]): APIEmbed {
	return {
		...embed,
		author: embed.author
			? {
					...embed.author,
					name: censorRequiredText(embed.author.name, `${path}/author/name`, terms, ranges)
				}
			: undefined,
		title: censorOptionalText(embed.title, `${path}/title`, terms, ranges) ?? undefined,
		description: censorOptionalText(embed.description, `${path}/description`, terms, ranges) ?? undefined,
		fields: embed.fields?.map((field, index) => ({
			...field,
			name: censorRequiredText(field.name, `${path}/fields/${index}/name`, terms, ranges),
			value: censorRequiredText(field.value, `${path}/fields/${index}/value`, terms, ranges)
		})),
		footer: embed.footer
			? {
					...embed.footer,
					text: censorRequiredText(embed.footer.text, `${path}/footer/text`, terms, ranges)
				}
			: undefined
	};
}

function censorButton(
	button: ButtonComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): ButtonComponent {
	return {
		...button,
		label: censorOptionalText(button.label, `${path}/label`, terms, ranges) ?? undefined
	};
}

function censorSelect(
	select: SelectMenuComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): SelectMenuComponent {
	const placeholder = censorOptionalText(select.placeholder, `${path}/placeholder`, terms, ranges) ?? undefined;
	if (select.type !== ComponentType.StringSelect) {
		return { ...select, placeholder };
	}

	const stringSelect: StringSelectComponent = select;
	return {
		...stringSelect,
		placeholder,
		options: stringSelect.options.map((option, index) => ({
			...option,
			label: censorRequiredText(option.label, `${path}/options/${index}/label`, terms, ranges),
			description: censorOptionalText(option.description, `${path}/options/${index}/description`, terms, ranges) ?? undefined
		}))
	};
}

function censorActionRow(
	row: ActionRowComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): ActionRowComponent {
	return {
		...row,
		components: row.components.map((component, index) => {
			const componentPath = `${path}/components/${index}`;
			return component.type === ComponentType.Button
				? censorButton(component, componentPath, terms, ranges)
				: censorSelect(component, componentPath, terms, ranges);
		})
	};
}

function censorThumbnail(
	thumbnail: ThumbnailComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): ThumbnailComponent {
	return {
		...thumbnail,
		description: censorOptionalText(thumbnail.description, `${path}/description`, terms, ranges)
	};
}

function censorMediaGallery(
	gallery: MediaGalleryComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): MediaGalleryComponent {
	return {
		...gallery,
		items: gallery.items.map((item, index) => ({
			...item,
			description: censorOptionalText(item.description, `${path}/items/${index}/description`, terms, ranges)
		}))
	};
}

function censorSection(
	section: SectionComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): SectionComponent {
	return {
		...section,
		components: section.components.map((display, index) => ({
			...display,
			content: censorRequiredText(display.content, `${path}/components/${index}/content`, terms, ranges)
		})),
		accessory:
			section.accessory.type === ComponentType.Button
				? censorButton(section.accessory, `${path}/accessory`, terms, ranges)
				: censorThumbnail(section.accessory, `${path}/accessory`, terms, ranges)
	};
}

function censorContainerChild(
	component: ContainerChildComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): ContainerChildComponent {
	switch (component.type) {
		case ComponentType.ActionRow:
			return censorActionRow(component, path, terms, ranges);
		case ComponentType.TextDisplay:
			return {
				...component,
				content: censorRequiredText(component.content, `${path}/content`, terms, ranges)
			};
		case ComponentType.Section:
			return censorSection(component, path, terms, ranges);
		case ComponentType.MediaGallery:
			return censorMediaGallery(component, path, terms, ranges);
		case ComponentType.Separator:
		case ComponentType.File:
			return component;
		default:
			// Runtime payloads can gain new Discord component types before our unions do.
			return component;
	}
}

function censorTopLevelComponent(
	component: MessageTopLevelComponent,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): MessageTopLevelComponent {
	switch (component.type) {
		case ComponentType.ActionRow:
			return censorActionRow(component, path, terms, ranges);
		case ComponentType.Container:
			return {
				...component,
				components: component.components.map((child, index) =>
					censorContainerChild(child, `${path}/components/${index}`, terms, ranges)
				)
			};
		case ComponentType.TextDisplay:
			return {
				...component,
				content: censorRequiredText(component.content, `${path}/content`, terms, ranges)
			};
		case ComponentType.Section:
			return censorSection(component, path, terms, ranges);
		case ComponentType.MediaGallery:
			return censorMediaGallery(component, path, terms, ranges);
		case ComponentType.Separator:
		case ComponentType.File:
			return component;
		default:
			// Runtime payloads can gain new Discord component types before our unions do.
			return component;
	}
}

function censorPoll(poll: APIPoll, path: string, terms: readonly CensorTerm[], ranges: CensoredTextRange[]): APIPoll {
	return {
		...poll,
		question: {
			...poll.question,
			text: censorOptionalText(poll.question.text, `${path}/question/text`, terms, ranges) ?? undefined
		},
		answers: poll.answers.map((answer, index) => ({
			...answer,
			poll_media: {
				...answer.poll_media,
				text: censorOptionalText(answer.poll_media.text, `${path}/answers/${index}/poll_media/text`, terms, ranges) ?? undefined
			}
		}))
	};
}

function censorSnapshot(
	snapshot: DraftMessageSnapshot,
	path: string,
	terms: readonly CensorTerm[],
	ranges: CensoredTextRange[]
): DraftMessageSnapshot {
	const messagePath = `${path}/message`;
	return {
		message: {
			...snapshot.message,
			content: censorRequiredText(snapshot.message.content, `${messagePath}/content`, terms, ranges),
			embeds: snapshot.message.embeds?.map((embed, index) => censorEmbed(embed, `${messagePath}/embeds/${index}`, terms, ranges)),
			components: snapshot.message.components?.map((component, index) =>
				censorTopLevelComponent(component, `${messagePath}/components/${index}`, terms, ranges)
			),
			poll: snapshot.message.poll ? censorPoll(snapshot.message.poll, `${messagePath}/poll`, terms, ranges) : undefined
		}
	};
}

function censorMessage(
	message: StoredCompactMessage,
	terms: readonly CensorTerm[]
): {
	message: StoredCompactMessage;
	ranges: CensoredTextRange[];
} {
	const ranges: CensoredTextRange[] = [];
	return {
		message: {
			...message,
			content: censorOptionalText(message.content, "/content", terms, ranges) ?? undefined,
			embeds: message.embeds?.map((embed, index) => censorEmbed(embed, `/embeds/${index}`, terms, ranges)),
			components: message.components?.map((component, index) =>
				censorTopLevelComponent(component, `/components/${index}`, terms, ranges)
			),
			poll: message.poll ? censorPoll(message.poll, "/poll", terms, ranges) : undefined,
			message_snapshots: message.message_snapshots?.map((snapshot, index) =>
				censorSnapshot(snapshot, `/message_snapshots/${index}`, terms, ranges)
			),
			referenced_message: message.referenced_message
				? {
						...message.referenced_message,
						content:
							censorOptionalText(message.referenced_message.content, "/referenced_message/content", terms, ranges) ?? undefined,
						embeds: message.referenced_message.embeds?.map((embed, index) =>
							censorEmbed(embed, `/referenced_message/embeds/${index}`, terms, ranges)
						)
					}
				: message.referenced_message
		},
		ranges
	};
}

function copyExistingRanges(context: DiscordContext | undefined): Record<string, CensoredTextRange[]> {
	const copied: Record<string, CensoredTextRange[]> = {};
	for (const [messageId, ranges] of Object.entries(context?.censored_ranges ?? {})) {
		copied[messageId] = ranges.map((range) => ({ ...range }));
	}
	return copied;
}

function sortCensoredRanges(rangesByMessage: Record<string, CensoredTextRange[]>): Record<string, CensoredTextRange[]> {
	const sorted: Record<string, CensoredTextRange[]> = {};
	for (const messageId of Object.keys(rangesByMessage).sort()) {
		const ranges = rangesByMessage[messageId];
		if (!ranges?.length) {
			continue;
		}

		sorted[messageId] = [...ranges].sort(
			(left, right) => left.path.localeCompare(right.path) || left.start - right.start || left.end - right.end
		);
	}
	return sorted;
}

/**
 * Replace literal terms in every stored user-visible text field and retain only
 * non-sensitive locations for viewer decoration. The source word list is never
 * added to the returned transcript.
 */
export function applyTranscriptCensorship(transcript: StoredTranscript, options?: TranscriptCensorshipOptions): StoredTranscript {
	const terms = normalizeCensorTerms(options?.censoredWords);
	if (terms.length === 0) {
		return transcript;
	}

	const rangesByMessage = copyExistingRanges(transcript.context);
	const messages = transcript.messages.map((message) => {
		const censored = censorMessage(message, terms);
		if (censored.ranges.length > 0) {
			rangesByMessage[message.id] = [...(rangesByMessage[message.id] ?? []), ...censored.ranges];
		}
		return censored.message;
	});
	const censoredRanges = sortCensoredRanges(rangesByMessage);

	return {
		messages,
		context:
			Object.keys(censoredRanges).length > 0
				? {
						...(transcript.context ?? {}),
						censored_ranges: censoredRanges
					}
				: transcript.context
	};
}
