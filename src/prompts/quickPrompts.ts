import type { TranslationKey, Translator } from "../i18n";
import type { QuickPromptItem, QuickPromptsConfig } from "../settings/types";

export interface BuiltInQuickPromptDefinition {
	id: string;
	labelKey: TranslationKey;
	instructionKey: TranslationKey;
}

export const BUILT_IN_QUICK_PROMPTS: BuiltInQuickPromptDefinition[] = [
	{
		id: "fix-grammar",
		labelKey: "preset.fixGrammar.label",
		instructionKey: "preset.fixGrammar.instruction",
	},
	{
		id: "make-clear",
		labelKey: "preset.makeClear.label",
		instructionKey: "preset.makeClear.instruction",
	},
	{
		id: "make-shorter",
		labelKey: "preset.makeShorter.label",
		instructionKey: "preset.makeShorter.instruction",
	},
	{
		id: "formal-tone",
		labelKey: "preset.formalTone.label",
		instructionKey: "preset.formalTone.instruction",
	},
	{
		id: "translate-en",
		labelKey: "preset.translateEn.label",
		instructionKey: "preset.translateEn.instruction",
	},
	{
		id: "translate-ru",
		labelKey: "preset.translateRu.label",
		instructionKey: "preset.translateRu.instruction",
	},
];

export function getBuiltInQuickPrompt(
	id: string,
	t: Translator,
): QuickPromptItem | null {
	const definition = BUILT_IN_QUICK_PROMPTS.find((item) => item.id === id);
	if (!definition) {
		return null;
	}

	return {
		id: definition.id,
		label: t(definition.labelKey),
		instruction: t(definition.instructionKey),
	};
}

export function resolveQuickPrompts(
	config: QuickPromptsConfig,
	t: Translator,
): QuickPromptItem[] {
	const hidden = new Set(
		config.hiddenBuiltInIds
			.map((id) => id.trim())
			.filter((id) => id.length > 0),
	);
	const builtInOverrides = new Map<string, QuickPromptItem>();
	for (const item of config.builtInOverrides) {
		const id = item.id.trim();
		if (!id) {
			continue;
		}
		builtInOverrides.set(id, item);
	}

	const result: QuickPromptItem[] = [];
	const seen = new Set<string>();

	for (const definition of BUILT_IN_QUICK_PROMPTS) {
		if (hidden.has(definition.id)) {
			continue;
		}

		const defaultPrompt: QuickPromptItem = {
			id: definition.id,
			label: t(definition.labelKey),
			instruction: t(definition.instructionKey),
		};
		const override = builtInOverrides.get(definition.id);
		const prompt: QuickPromptItem = {
			id: definition.id,
			label: override?.label.trim() || defaultPrompt.label,
			instruction:
				override?.instruction.trim() || defaultPrompt.instruction,
		};
		if (override?.providerId) {
			prompt.providerId = override.providerId;
		}
		if (override?.model?.trim()) {
			prompt.model = override.model.trim();
		}
		if (!prompt.label || !prompt.instruction || seen.has(prompt.id)) {
			continue;
		}

		seen.add(prompt.id);
		result.push(prompt);
	}

	for (const customPrompt of config.custom) {
		const prompt: QuickPromptItem = {
			id: customPrompt.id.trim(),
			label: customPrompt.label.trim(),
			instruction: customPrompt.instruction.trim(),
		};
		if (customPrompt.providerId) {
			prompt.providerId = customPrompt.providerId;
		}
		if (customPrompt.model?.trim()) {
			prompt.model = customPrompt.model.trim();
		}
		if (
			!prompt.id ||
			!prompt.label ||
			!prompt.instruction ||
			seen.has(prompt.id)
		) {
			continue;
		}

		seen.add(prompt.id);
		result.push(prompt);
	}

	return result;
}

// The panel doesn't track which preset filled the textarea; a prompt's routing
// override applies when the submitted instruction still exactly matches that
// prompt (edited instructions honestly fall back to the global provider).
export function findQuickPromptForInstruction(
	prompts: QuickPromptItem[],
	instruction: string,
): QuickPromptItem | null {
	const trimmed = instruction.trim();
	if (!trimmed) {
		return null;
	}
	return prompts.find((prompt) => prompt.instruction.trim() === trimmed) ?? null;
}
