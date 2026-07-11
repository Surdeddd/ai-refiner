import { type Editor, type EditorPosition, Notice } from "obsidian";
import type { Translator } from "../i18n";
import { resolveQuickPrompts } from "../prompts/quickPrompts";
import { ProviderFactory } from "../providers/ProviderFactory";
import { throwIfAborted } from "../providers/IAIProvider";
import type { AIRefinerSettings } from "../settings/types";
import { FloatingInput, type FloatingAnchor } from "../ui/FloatingInput";
import {
	extractNoteContext,
	extractParagraphContext,
	positionToOffset,
	type ContextScope,
} from "../utils/context";
import { getEditorBounds, getEditorFloatingMount, getPositionCoords, hasSelectedText } from "../utils/editor";

export type TriggerSource = "command" | "hotkey" | "ribbon";

const OUTPUT_POLICY = [
	"Return only the final refined text.",
	"Do not include any explanations, comments, labels, markdown fences, or bullet lists.",
	"Do not mention instructions, model behavior, system messages, or metadata.",
	"Keep original language unless the instruction explicitly requests translation.",
].join("\n");

export interface SelectionSnapshot {
	text: string;
	from: EditorPosition;
	to: EditorPosition;
}

// Replaces the snapshotted selection, guarding against the document having changed
// while the request ran — replacing by stale positions would overwrite unrelated
// text. Exported for unit tests.
export function replaceSnapshotSelection(
	editor: Editor,
	snapshot: SelectionSnapshot,
	refinedText: string,
	t: Translator,
): void {
	if (editor.getRange(snapshot.from, snapshot.to) !== snapshot.text) {
		throw new Error(t("error.selectionChanged"));
	}
	editor.replaceRange(refinedText, snapshot.from, snapshot.to);
	editor.setSelection(snapshot.from, getReplacementEnd(snapshot.from, refinedText));
}

export class RefineSelectionService {
	private readonly providerFactory: ProviderFactory;
	private activeInput: FloatingInput | null = null;

	constructor(
		private readonly getSettings: () => AIRefinerSettings,
		private readonly getTranslator: () => Translator,
		private readonly getVoiceLocale: () => string,
		private readonly saveSettings: () => Promise<void> = async () => undefined,
		providerFactory: ProviderFactory = new ProviderFactory(),
	) {
		this.providerFactory = providerFactory;
	}

	async run(editor: Editor, triggerSource: TriggerSource): Promise<void> {
		const t = this.getTranslator();
		const settings = this.getSettings();

		if (this.activeInput?.isSubmittingRequest()) {
			new Notice(t("notice.refineInProgress"));
			return;
		}

		if (!hasSelectedText(editor)) {
			if (triggerSource === "ribbon") {
				new Notice(t("notice.pleaseSelectTextFirst"));
			} else {
				new Notice(t("notice.selectTextToRefineFirst"));
			}
			return;
		}

		const snapshot = this.captureSelection(editor);
		if (!snapshot) {
			new Notice(t("notice.pleaseSelectTextFirst"));
			return;
		}

		const anchorResolver = (): FloatingAnchor | null => getPositionCoords(editor, snapshot.to);
		const boundsResolver = () => getEditorBounds(editor);
		const anchor = anchorResolver() ?? this.getFallbackAnchor(boundsResolver() ?? null);
		const mountEl = getEditorFloatingMount(editor);
		const quickPrompts = resolveQuickPrompts(settings.quickPrompts, t);

		this.activeInput?.close();
		const floatingInput = new FloatingInput({
			anchor,
			anchorResolver,
			boundsResolver,
			mountEl: mountEl ?? undefined,
			t,
			voiceInput: {
				enabled: settings.voiceInput.enabled,
				languageCode: this.getVoiceLocale(),
				apiEndpoint: settings.voiceInput.apiEndpoint,
				apiModel: settings.voiceInput.apiModel,
				apiToken: settings.voiceInput.apiToken.trim(),
			},
			presets: quickPrompts,
			resultMode: settings.resultMode,
			originalText: snapshot.text,
			contextScope: settings.contextScope,
			onContextScopeChange: (scope: ContextScope) => {
				this.getSettings().contextScope = scope;
				void this.saveSettings();
			},
			onSubmit: (instruction: string, signal: AbortSignal, onChunk?: (delta: string) => void) =>
				this.generateRefinedText(editor, snapshot, instruction, signal, onChunk),
			onApply: (refinedText: string) => {
				replaceSnapshotSelection(editor, snapshot, refinedText, this.getTranslator());
			},
			onClose: () => {
				if (this.activeInput === floatingInput) {
					this.activeInput = null;
				}
			},
		});

		this.activeInput = floatingInput;
		floatingInput.open();
	}

	dispose(): void {
		this.activeInput?.forceClose();
		this.activeInput = null;
	}

	private captureSelection(editor: Editor): SelectionSnapshot | null {
		const text = editor.getSelection();
		if (!text.length) {
			return null;
		}

		return {
			text,
			from: clonePosition(editor.getCursor("from")),
			to: clonePosition(editor.getCursor("to")),
		};
	}

	// Generation only — never touches the editor except to READ context. The panel
	// decides what happens to the result (immediate apply vs preview) via onApply.
	private async generateRefinedText(
		editor: Editor,
		snapshot: SelectionSnapshot,
		instruction: string,
		signal: AbortSignal,
		onChunk?: (delta: string) => void,
	): Promise<string> {
		const trimmedInstruction = instruction.trim();
		if (!trimmedInstruction) {
			throw new Error(this.getTranslator()("error.instructionCannotBeEmpty"));
		}
		throwIfAborted(signal);

		const settings = this.getSettings();
		// ProviderFactory resolves the platform-effective provider itself; a stored
		// desktop CLI choice silently routes to an API provider on mobile.
		const provider = this.providerFactory.create(settings);
		const context = extractContextForScope(editor, snapshot, settings.contextScope);
		const finalInstruction = buildFinalInstruction(
			settings.prompt.prependInstruction,
			trimmedInstruction,
			context,
		);
		const refinedText = await provider.generate(snapshot.text, finalInstruction, { signal, onChunk });
		throwIfAborted(signal);
		if (!refinedText.trim()) {
			throw new Error(this.getTranslator()("error.providerReturnedEmptyOutput"));
		}

		return refinedText;
	}

	private getFallbackAnchor(bounds: { left: number; right: number; top: number; bottom: number } | null): FloatingAnchor {
		const left = bounds ? bounds.left + (bounds.right - bounds.left) / 2 : window.scrollX + window.innerWidth / 2;
		const top = bounds ? bounds.top + (bounds.bottom - bounds.top) / 2 : window.scrollY + window.innerHeight / 2;
		return {
			left,
			top,
			bottom: top + 24,
		};
	}
}

function clonePosition(position: EditorPosition): EditorPosition {
	return {
		line: position.line,
		ch: position.ch,
	};
}

function getReplacementEnd(from: EditorPosition, insertedText: string): EditorPosition {
	const lines = insertedText.split("\n");
	const lastLine = lines[lines.length - 1] ?? "";
	if (lines.length === 1) {
		return { line: from.line, ch: from.ch + lastLine.length };
	}
	return { line: from.line + lines.length - 1, ch: lastLine.length };
}

// Exported for tests. Context is read-only reference material — the model must still
// rewrite ONLY the selected text it receives through the Text channel.
export function buildFinalInstruction(
	prependInstruction: string,
	userInstruction: string,
	context: string | null = null,
): string {
	const instructionParts = [prependInstruction.trim(), userInstruction.trim()].filter((value) => value.length > 0);
	const contextBlock = context && context.trim().length > 0
		? `\n\nSurrounding context (reference only — rewrite ONLY the text given below, never the context):\n${context}`
		: "";
	return `${instructionParts.join("\n\n")}${contextBlock}\n\nOutput requirements:\n${OUTPUT_POLICY}`;
}

// Exported for tests: resolves what extra material a scope sends along.
export function extractContextForScope(
	editor: Editor,
	snapshot: SelectionSnapshot,
	scope: ContextScope,
): string | null {
	if (scope === "selection") {
		return null;
	}

	const noteText = editor.getValue();
	if (scope === "note") {
		const lines = noteText.split("\n");
		const offset = positionToOffset(lines, snapshot.from.line, snapshot.from.ch);
		return extractNoteContext(noteText, offset);
	}

	const lines = noteText.split("\n");
	const paragraph = extractParagraphContext(lines, snapshot.from.line, snapshot.to.line);
	// The paragraph IS the selection (nothing around it) — no extra context to send.
	return paragraph === snapshot.text ? null : paragraph;
}
