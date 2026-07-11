import { Setting } from "obsidian";
import type { Translator } from "../../i18n";
import { BUILT_IN_QUICK_PROMPTS, getBuiltInQuickPrompt } from "../../prompts/quickPrompts";
import type { QuickPromptItem } from "../types";
import type { SettingsSectionContext } from "./context";

export function renderPrependInstructionSection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;

	new Setting(containerEl)
		.setName(t("settings.resultMode.name"))
		.setDesc(t("settings.resultMode.desc"))
		.addDropdown((dropdown) => {
			dropdown
				.addOption("preview", t("settings.resultMode.preview"))
				.addOption("replace", t("settings.resultMode.replace"))
				.setValue(ctx.settings.resultMode)
				.onChange((value) => {
					ctx.settings.resultMode = value === "replace" ? "replace" : "preview";
					ctx.scheduleSave();
				});
		});

	new Setting(containerEl)
		.setName(t("settings.prompt.prepend.name"))
		.setDesc(t("settings.prompt.prepend.desc"))
		.addText((text) => {
			text
				.setPlaceholder(t("settings.prompt.prepend.placeholder"))
				.setValue(ctx.settings.prompt.prependInstruction)
				.onChange((value) => {
					ctx.settings.prompt.prependInstruction = value;
					ctx.scheduleSave();
				});
		});
}

export function renderQuickPromptsSection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const promptsContainer = containerEl.createDiv({
		cls: "ai-refiner-settings-prompts",
	});

	new Setting(promptsContainer)
		.setName(t("settings.quickPrompts.block.name"))
		.setDesc(t("settings.quickPrompts.block.desc"))
		.addButton((button) => {
			button.setButtonText(t("settings.quickPrompts.addCustom"));
			button.onClick(() => {
				ctx.settings.quickPrompts.custom.push({
					id: createCustomPromptId(),
					label: t("settings.quickPrompts.newCustomLabel"),
					instruction: "",
				});
				ctx.scheduleSave();
				ctx.rerender();
			});
		})
		.addButton((button) => {
			button.setButtonText(t("settings.quickPrompts.resetDefaults"));
			button.onClick(() => {
				ctx.settings.quickPrompts.builtInOverrides = [];
				ctx.settings.quickPrompts.hiddenBuiltInIds = [];
				ctx.scheduleSave();
				ctx.rerender();
			});
		});

	const defaultsTitle = promptsContainer.createDiv({ cls: "ai-refiner-prompt-group-title" });
	defaultsTitle.setText(t("settings.quickPrompts.defaults"));
	for (const definition of BUILT_IN_QUICK_PROMPTS) {
		renderBuiltInPromptEditor(promptsContainer, definition.id, ctx);
	}

	const customTitle = promptsContainer.createDiv({ cls: "ai-refiner-prompt-group-title" });
	customTitle.setText(t("settings.quickPrompts.custom"));

	if (ctx.settings.quickPrompts.custom.length === 0) {
		const empty = promptsContainer.createDiv({ cls: "ai-refiner-prompt-empty" });
		empty.setText(t("settings.quickPrompts.customEmpty"));
		return;
	}

	for (const prompt of ctx.settings.quickPrompts.custom) {
		renderCustomPromptEditor(promptsContainer, prompt, ctx);
	}
}

function renderBuiltInPromptEditor(containerEl: HTMLElement, promptId: string, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const defaults = getBuiltInQuickPrompt(promptId, t);
	if (!defaults) {
		return;
	}

	const overrides = ctx.settings.quickPrompts.builtInOverrides;
	const override = overrides.find((item) => item.id === promptId);
	const isHidden = ctx.settings.quickPrompts.hiddenBuiltInIds.includes(promptId);
	const labelValue = override?.label ?? defaults.label;
	const instructionValue = override?.instruction ?? defaults.instruction;

	const card = containerEl.createDiv({ cls: "ai-refiner-prompt-editor" });
	const header = card.createDiv({ cls: "ai-refiner-prompt-editor__header" });
	header.createDiv({ cls: "ai-refiner-prompt-editor__title", text: defaults.label });
	header.createDiv({ cls: "ai-refiner-prompt-editor__tag", text: t("settings.quickPrompts.defaultTag") });

	if (isHidden) {
		card.createDiv({
			cls: "ai-refiner-prompt-editor__hidden",
			text: t("settings.quickPrompts.defaultHidden"),
		});

		const actions = card.createDiv({ cls: "ai-refiner-prompt-editor__actions" });
		const restoreButton = actions.createEl("button", {
			cls: "mod-cta",
			text: t("settings.quickPrompts.restore"),
		});
		restoreButton.addEventListener("click", () => {
			restoreBuiltInPrompt(ctx, promptId);
			ctx.scheduleSave();
			ctx.rerender();
		});
		return;
	}

	const labelInput = card.createEl("input", {
		type: "text",
		cls: "ai-refiner-prompt-editor__label",
	});
	labelInput.placeholder = defaults.label;
	labelInput.value = labelValue;

	const instructionInput = card.createEl("textarea", {
		cls: "ai-refiner-prompt-editor__instruction",
	});
	instructionInput.rows = 3;
	instructionInput.placeholder = defaults.instruction;
	instructionInput.value = instructionValue;

	const persist = (): void => {
		updateBuiltInPromptOverride(ctx, promptId, labelInput.value, instructionInput.value, t);
	};
	labelInput.addEventListener("input", persist);
	instructionInput.addEventListener("input", persist);

	const actions = card.createDiv({ cls: "ai-refiner-prompt-editor__actions" });
	const resetButton = actions.createEl("button", { text: t("settings.quickPrompts.resetOne") });
	resetButton.addEventListener("click", () => {
		restoreBuiltInPrompt(ctx, promptId);
		ctx.scheduleSave();
		ctx.rerender();
	});
	const hideButton = actions.createEl("button", { text: t("settings.quickPrompts.delete") });
	hideButton.addEventListener("click", () => {
		hideBuiltInPrompt(ctx, promptId);
		ctx.scheduleSave();
		ctx.rerender();
	});
}

function renderCustomPromptEditor(containerEl: HTMLElement, prompt: QuickPromptItem, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const card = containerEl.createDiv({ cls: "ai-refiner-prompt-editor" });
	const header = card.createDiv({ cls: "ai-refiner-prompt-editor__header" });
	header.createDiv({ cls: "ai-refiner-prompt-editor__title", text: prompt.label || t("settings.quickPrompts.newCustomLabel") });
	header.createDiv({ cls: "ai-refiner-prompt-editor__tag", text: t("settings.quickPrompts.customTag") });

	const labelInput = card.createEl("input", {
		type: "text",
		cls: "ai-refiner-prompt-editor__label",
	});
	labelInput.placeholder = t("settings.quickPrompts.labelPlaceholder");
	labelInput.value = prompt.label;

	const instructionInput = card.createEl("textarea", {
		cls: "ai-refiner-prompt-editor__instruction",
	});
	instructionInput.rows = 3;
	instructionInput.placeholder = t("settings.quickPrompts.instructionPlaceholder");
	instructionInput.value = prompt.instruction;

	const persist = (): void => {
		const target = ctx.settings.quickPrompts.custom.find((item) => item.id === prompt.id);
		if (!target) {
			return;
		}

		target.label = labelInput.value;
		target.instruction = instructionInput.value;
		ctx.scheduleSave();
	};
	labelInput.addEventListener("input", persist);
	instructionInput.addEventListener("input", persist);

	const actions = card.createDiv({ cls: "ai-refiner-prompt-editor__actions" });
	const deleteButton = actions.createEl("button", { text: t("settings.quickPrompts.delete") });
	deleteButton.addEventListener("click", () => {
		ctx.settings.quickPrompts.custom = ctx.settings.quickPrompts.custom.filter(
			(item) => item.id !== prompt.id,
		);
		ctx.scheduleSave();
		ctx.rerender();
	});
}

function updateBuiltInPromptOverride(
	ctx: SettingsSectionContext,
	promptId: string,
	label: string,
	instruction: string,
	t: Translator,
): void {
	const defaults = getBuiltInQuickPrompt(promptId, t);
	if (!defaults) {
		return;
	}

	ctx.settings.quickPrompts.hiddenBuiltInIds = ctx.settings.quickPrompts.hiddenBuiltInIds.filter(
		(id) => id !== promptId,
	);

	const normalizedLabel = label.trim();
	const normalizedInstruction = instruction.trim();
	const isDefaultValue = normalizedLabel === defaults.label && normalizedInstruction === defaults.instruction;
	const overrides = ctx.settings.quickPrompts.builtInOverrides;
	const existingIndex = overrides.findIndex((item) => item.id === promptId);

	if (isDefaultValue) {
		if (existingIndex >= 0) {
			overrides.splice(existingIndex, 1);
		}
		ctx.scheduleSave();
		return;
	}

	const nextValue: QuickPromptItem = {
		id: promptId,
		label,
		instruction,
	};

	if (existingIndex >= 0) {
		overrides[existingIndex] = nextValue;
	} else {
		overrides.push(nextValue);
	}

	ctx.scheduleSave();
}

function restoreBuiltInPrompt(ctx: SettingsSectionContext, promptId: string): void {
	ctx.settings.quickPrompts.hiddenBuiltInIds = ctx.settings.quickPrompts.hiddenBuiltInIds.filter(
		(id) => id !== promptId,
	);
	ctx.settings.quickPrompts.builtInOverrides = ctx.settings.quickPrompts.builtInOverrides.filter(
		(item) => item.id !== promptId,
	);
}

function hideBuiltInPrompt(ctx: SettingsSectionContext, promptId: string): void {
	if (!ctx.settings.quickPrompts.hiddenBuiltInIds.includes(promptId)) {
		ctx.settings.quickPrompts.hiddenBuiltInIds.push(promptId);
	}

	ctx.settings.quickPrompts.builtInOverrides = ctx.settings.quickPrompts.builtInOverrides.filter(
		(item) => item.id !== promptId,
	);
}

function createCustomPromptId(): string {
	return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
