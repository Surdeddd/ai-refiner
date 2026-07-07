import { type Editor, type EditorPosition, Notice } from "obsidian";
import type { Translator } from "../i18n";
import { resolveQuickPrompts } from "../prompts/quickPrompts";
import { ProviderFactory } from "../providers/ProviderFactory";
import { throwIfAborted } from "../providers/IAIProvider";
import { isProviderSupportedOnCurrentPlatform } from "../providers/providerAvailability";
import type { AIRefinerSettings } from "../settings/types";
import { FloatingInput, type FloatingAnchor } from "../ui/FloatingInput";
import { getEditorBounds, getEditorFloatingMount, getPositionCoords, hasSelectedText } from "../utils/editor";

export type TriggerSource = "command" | "hotkey" | "ribbon";

const OUTPUT_POLICY = [
	"Return only the final refined text.",
	"Do not include any explanations, comments, labels, markdown fences, or bullet lists.",
	"Do not mention instructions, model behavior, system messages, or metadata.",
	"Keep original language unless the instruction explicitly requests translation.",
].join("\n");

interface SelectionSnapshot {
	text: string;
	from: EditorPosition;
	to: EditorPosition;
}

export class RefineSelectionService {
	private readonly providerFactory: ProviderFactory;
	private activeInput: FloatingInput | null = null;

	constructor(
		private readonly getSettings: () => AIRefinerSettings,
		private readonly getTranslator: () => Translator,
		private readonly getVoiceLocale: () => string,
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
			onSubmit: async (instruction: string, signal: AbortSignal) => {
				await this.refine(editor, snapshot, instruction, signal);
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

	private async refine(
		editor: Editor,
		snapshot: SelectionSnapshot,
		instruction: string,
		signal: AbortSignal,
	): Promise<void> {
		const trimmedInstruction = instruction.trim();
		if (!trimmedInstruction) {
			throw new Error(this.getTranslator()("error.instructionCannotBeEmpty"));
		}
		throwIfAborted(signal);

		const settings = this.getSettings();
		if (!isProviderSupportedOnCurrentPlatform(settings.activeProvider)) {
			throw new Error(this.getTranslator()("error.providerNotSupportedOnPlatform"));
		}

		const provider = this.providerFactory.create(settings);
		const finalInstruction = buildFinalInstruction(settings.prompt.prependInstruction, trimmedInstruction);
		const refinedText = await provider.generate(snapshot.text, finalInstruction, { signal });
		throwIfAborted(signal);
		if (!refinedText.trim()) {
			throw new Error(this.getTranslator()("error.providerReturnedEmptyOutput"));
		}

		// The document may have changed while the request was running; replacing
		// by stale positions would overwrite unrelated text.
		if (editor.getRange(snapshot.from, snapshot.to) !== snapshot.text) {
			throw new Error(this.getTranslator()("error.selectionChanged"));
		}
		throwIfAborted(signal);
		editor.replaceRange(refinedText, snapshot.from, snapshot.to);
		editor.setSelection(snapshot.from, getReplacementEnd(snapshot.from, refinedText));
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

function buildFinalInstruction(prependInstruction: string, userInstruction: string): string {
	const instructionParts = [prependInstruction.trim(), userInstruction.trim()].filter((value) => value.length > 0);
	return `${instructionParts.join("\n\n")}\n\nOutput requirements:\n${OUTPUT_POLICY}`;
}
