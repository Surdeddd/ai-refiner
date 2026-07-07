import { App, Plugin, PluginSettingTab, Setting, getLanguage } from "obsidian";
import {
	createTranslator,
	getLanguageLabel,
	getSupportedLanguages,
	isPluginLanguage,
	resolvePluginLanguage,
	type Translator,
} from "../i18n";
import {
	PROVIDER_ORDER,
	getFallbackProviderForCurrentPlatform,
	getSupportedProvidersForCurrentPlatform,
} from "../providers/providerAvailability";
import { BUILT_IN_QUICK_PROMPTS, getBuiltInQuickPrompt } from "../prompts/quickPrompts";
import { discoverModelsForProvider } from "../providers/HttpApiProvider";
import { discoverOllamaModels } from "../providers/OllamaLocalProvider";
import { NPX_PRESETS, normalizeCliArgsForExecutable } from "../providers/cliPresets";
import {
	formatHotkeyForDisplay,
	hotkeyComboFromKeyboardEvent,
	normalizeHotkeyCombo,
} from "../utils/hotkey";
import { isPrivateHost } from "../utils/api";
import type {
	AIRefinerSettings,
	ApiProviderId,
	CliProviderId,
	LanguageMode,
	LocalProviderId,
	ProviderId,
	QuickPromptItem,
} from "./types";

export interface SettingsHost extends Plugin {
	settings: AIRefinerSettings;
	saveSettings(): Promise<void>;
}

type ModelDiscoverProviderId = ApiProviderId | LocalProviderId;
const MODEL_RETRY_COOLDOWN_MS = 10_000;

interface ModelUiRefs {
	statusEl: HTMLElement;
	inputEl: HTMLInputElement;
	datalistEl: HTMLElement;
}

export class AIRefinerSettingTab extends PluginSettingTab {
	private readonly plugin: SettingsHost;
	private readonly detectedModels = new Map<ModelDiscoverProviderId, string[]>();
	private readonly modelDetectionInProgress = new Set<ModelDiscoverProviderId>();
	private readonly modelCacheKey = new Map<ModelDiscoverProviderId, string>();
	private readonly modelRefreshTimers = new Map<ModelDiscoverProviderId, number>();
	private readonly modelFailureKey = new Map<ModelDiscoverProviderId, string>();
	private readonly modelLastFailureAt = new Map<ModelDiscoverProviderId, number>();
	private readonly modelLastError = new Map<ModelDiscoverProviderId, string>();
	// Live references into the rendered model setting so async detection can
	// update status/datalist in place; a full display() rebuild would drop the
	// focus from whichever field the user is typing in.
	private readonly modelUiRefs = new Map<ModelDiscoverProviderId, ModelUiRefs>();
	private saveDebounceTimer: number | null = null;

	constructor(app: App, plugin: SettingsHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const t = this.getTranslator();
		containerEl.empty();
		this.modelUiRefs.clear();

		new Setting(containerEl)
			.setName(t("settings.heading"))
			.setHeading();

		new Setting(containerEl)
			.setName(t("settings.language.mode.name"))
			.setDesc(t("settings.language.mode.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("auto", t("settings.language.mode.auto"))
					.addOption("manual", t("settings.language.mode.manual"))
					.setValue(this.plugin.settings.languageMode)
					.onChange(async (value) => {
						if (!isLanguageMode(value)) {
							return;
						}

						this.plugin.settings.languageMode = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.languageMode === "auto") {
			const currentLanguage = getLanguageLabel(resolvePluginLanguage("auto", this.plugin.settings.language, getLanguage()));
			new Setting(containerEl)
				.setName(t("settings.language.autoDetected.name"))
				.setDesc(`${t("settings.language.autoDetected.desc")} ${currentLanguage}`);
		}

		if (this.plugin.settings.languageMode === "manual") {
			new Setting(containerEl)
				.setName(t("settings.language.name"))
				.setDesc(t("settings.language.desc"))
				.addDropdown((dropdown) => {
					for (const language of getSupportedLanguages()) {
						dropdown.addOption(language, getLanguageLabel(language));
					}

					dropdown.setValue(this.plugin.settings.language);
					dropdown.onChange(async (value) => {
						if (!isPluginLanguage(value)) {
							return;
						}

						this.plugin.settings.language = value;
						await this.plugin.saveSettings();
						this.display();
					});
				});
		}

		const supportedProviders = getSupportedProvidersForCurrentPlatform(PROVIDER_ORDER);
		const storedProvider = this.plugin.settings.activeProvider;
		const activeProvider = supportedProviders.includes(storedProvider)
			? storedProvider
			: getFallbackProviderForCurrentPlatform(storedProvider, PROVIDER_ORDER);
		if (activeProvider !== storedProvider) {
			this.plugin.settings.activeProvider = activeProvider;
			this.scheduleSave();
		}

		new Setting(containerEl)
			.setName(t("settings.provider.name"))
			.setDesc(t("settings.provider.desc"))
			.addDropdown((dropdown) => {
				for (const providerId of supportedProviders) {
					dropdown.addOption(providerId, this.getProviderLabel(providerId, t));
				}

				dropdown.setValue(activeProvider);
				dropdown.onChange(async (value) => {
					if (!isProviderId(value)) {
						return;
					}

					this.plugin.settings.activeProvider = value;
					await this.plugin.saveSettings();
						this.display();
					});
			});

		this.renderHotkeySettings(containerEl, t);
		this.renderVoiceSettings(containerEl, t);

		if (isCliProviderId(activeProvider)) {
			this.renderCliSettings(containerEl, activeProvider, t);
		} else if (activeProvider === "ollama-local") {
			this.renderOllamaSettings(containerEl, t);
		} else {
			this.renderApiSettings(containerEl, activeProvider, t);
		}

		new Setting(containerEl)
			.setName(t("settings.prompt.prepend.name"))
			.setDesc(t("settings.prompt.prepend.desc"))
			.addText((text) => {
				text
					.setPlaceholder(t("settings.prompt.prepend.placeholder"))
					.setValue(this.plugin.settings.prompt.prependInstruction)
					.onChange((value) => {
						this.plugin.settings.prompt.prependInstruction = value;
						this.scheduleSave();
					});
			});

		this.renderQuickPromptSettings(containerEl, t);
	}

	private renderHotkeySettings(containerEl: HTMLElement, t: Translator): void {
		const config = this.plugin.settings.hotkey;

		new Setting(containerEl)
			.setName(t("settings.hotkey.combo.name"))
			.setDesc(t("settings.hotkey.combo.desc"))
			.addText((text) => {
				text.inputEl.placeholder = t("settings.hotkey.combo.placeholder");
				text.inputEl.readOnly = true;
				text.setValue(formatHotkeyForDisplay(config.combo));

				text.inputEl.addEventListener("keydown", (event) => {
					event.preventDefault();
					event.stopPropagation();

					if (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") {
						config.combo = "";
						text.setValue("");
						this.scheduleSave();
						return;
					}

					const nextCombo = hotkeyComboFromKeyboardEvent(event);
					if (!nextCombo) {
						return;
					}

					config.combo = normalizeHotkeyCombo(nextCombo);
					text.setValue(formatHotkeyForDisplay(config.combo));
					this.scheduleSave();
				});
			})
			.addButton((button) => {
				button.setButtonText(t("settings.hotkey.clear"));
				button.onClick(() => {
					config.combo = "";
					this.scheduleSave();
					this.display();
				});
			});
	}

	private renderVoiceSettings(containerEl: HTMLElement, t: Translator): void {
		const config = this.plugin.settings.voiceInput;

		new Setting(containerEl)
			.setName(t("settings.voice.enabled.name"))
			.setDesc(t("settings.voice.enabled.desc"))
			.addToggle((toggle) => {
				toggle
					.setValue(config.enabled)
					.onChange((value) => {
						config.enabled = value;
						this.scheduleSave();
						this.display();
					});
			});

		if (!config.enabled) {
			return;
		}

		new Setting(containerEl)
			.setName(t("settings.voice.api.endpoint.name"))
			.setDesc(t("settings.voice.api.endpoint.desc"))
			.addText((text) => {
				text
					.setValue(config.apiEndpoint)
					.onChange((value) => {
						config.apiEndpoint = value.trim();
						this.scheduleSave();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.voice.api.model.name"))
			.setDesc(t("settings.voice.api.model.desc"))
			.addText((text) => {
				text
					.setValue(config.apiModel)
					.onChange((value) => {
						config.apiModel = value.trim();
						this.scheduleSave();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.voice.api.token.name"))
			.setDesc(t("settings.voice.api.token.desc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(t("settings.voice.api.token.placeholder"))
					.setValue(config.apiToken)
					.onChange((value) => {
						config.apiToken = value;
						this.scheduleSave();
					});
			});
	}

	private renderQuickPromptSettings(containerEl: HTMLElement, t: Translator): void {
		const promptsContainer = containerEl.createDiv({
			cls: "ai-refiner-settings-prompts",
		});

		new Setting(promptsContainer)
			.setName(t("settings.quickPrompts.block.name"))
			.setDesc(t("settings.quickPrompts.block.desc"))
			.addButton((button) => {
				button.setButtonText(t("settings.quickPrompts.addCustom"));
				button.onClick(() => {
					this.plugin.settings.quickPrompts.custom.push({
						id: createCustomPromptId(),
						label: t("settings.quickPrompts.newCustomLabel"),
						instruction: "",
					});
					this.scheduleSave();
					this.display();
				});
			})
			.addButton((button) => {
				button.setButtonText(t("settings.quickPrompts.resetDefaults"));
				button.onClick(() => {
					this.plugin.settings.quickPrompts.builtInOverrides = [];
					this.plugin.settings.quickPrompts.hiddenBuiltInIds = [];
					this.scheduleSave();
					this.display();
				});
			});

		const defaultsTitle = promptsContainer.createDiv({ cls: "ai-refiner-prompt-group-title" });
		defaultsTitle.setText(t("settings.quickPrompts.defaults"));
		for (const definition of BUILT_IN_QUICK_PROMPTS) {
			this.renderBuiltInPromptEditor(promptsContainer, definition.id, t);
		}

		const customTitle = promptsContainer.createDiv({ cls: "ai-refiner-prompt-group-title" });
		customTitle.setText(t("settings.quickPrompts.custom"));

		if (this.plugin.settings.quickPrompts.custom.length === 0) {
			const empty = promptsContainer.createDiv({ cls: "ai-refiner-prompt-empty" });
			empty.setText(t("settings.quickPrompts.customEmpty"));
			return;
		}

		for (const prompt of this.plugin.settings.quickPrompts.custom) {
			this.renderCustomPromptEditor(promptsContainer, prompt, t);
		}
	}

	private renderBuiltInPromptEditor(containerEl: HTMLElement, promptId: string, t: Translator): void {
		const defaults = getBuiltInQuickPrompt(promptId, t);
		if (!defaults) {
			return;
		}

		const overrides = this.plugin.settings.quickPrompts.builtInOverrides;
		const override = overrides.find((item) => item.id === promptId);
		const isHidden = this.plugin.settings.quickPrompts.hiddenBuiltInIds.includes(promptId);
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
				this.restoreBuiltInPrompt(promptId);
				this.scheduleSave();
				this.display();
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
			this.updateBuiltInPromptOverride(promptId, labelInput.value, instructionInput.value, t);
		};
		labelInput.addEventListener("input", persist);
		instructionInput.addEventListener("input", persist);

		const actions = card.createDiv({ cls: "ai-refiner-prompt-editor__actions" });
		const resetButton = actions.createEl("button", { text: t("settings.quickPrompts.resetOne") });
		resetButton.addEventListener("click", () => {
			this.restoreBuiltInPrompt(promptId);
			this.scheduleSave();
			this.display();
		});
		const hideButton = actions.createEl("button", { text: t("settings.quickPrompts.delete") });
		hideButton.addEventListener("click", () => {
			this.hideBuiltInPrompt(promptId);
			this.scheduleSave();
			this.display();
		});
	}

	private renderCustomPromptEditor(containerEl: HTMLElement, prompt: QuickPromptItem, t: Translator): void {
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
			const target = this.plugin.settings.quickPrompts.custom.find((item) => item.id === prompt.id);
			if (!target) {
				return;
			}

			target.label = labelInput.value;
			target.instruction = instructionInput.value;
			this.scheduleSave();
		};
		labelInput.addEventListener("input", persist);
		instructionInput.addEventListener("input", persist);

		const actions = card.createDiv({ cls: "ai-refiner-prompt-editor__actions" });
		const deleteButton = actions.createEl("button", { text: t("settings.quickPrompts.delete") });
		deleteButton.addEventListener("click", () => {
			this.plugin.settings.quickPrompts.custom = this.plugin.settings.quickPrompts.custom.filter(
				(item) => item.id !== prompt.id,
			);
			this.scheduleSave();
			this.display();
		});
	}

	private updateBuiltInPromptOverride(promptId: string, label: string, instruction: string, t: Translator): void {
		const defaults = getBuiltInQuickPrompt(promptId, t);
		if (!defaults) {
			return;
		}

		this.plugin.settings.quickPrompts.hiddenBuiltInIds = this.plugin.settings.quickPrompts.hiddenBuiltInIds.filter(
			(id) => id !== promptId,
		);

		const normalizedLabel = label.trim();
		const normalizedInstruction = instruction.trim();
		const isDefaultValue = normalizedLabel === defaults.label && normalizedInstruction === defaults.instruction;
		const overrides = this.plugin.settings.quickPrompts.builtInOverrides;
		const existingIndex = overrides.findIndex((item) => item.id === promptId);

		if (isDefaultValue) {
			if (existingIndex >= 0) {
				overrides.splice(existingIndex, 1);
			}
			this.scheduleSave();
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

		this.scheduleSave();
	}

	private restoreBuiltInPrompt(promptId: string): void {
		this.plugin.settings.quickPrompts.hiddenBuiltInIds = this.plugin.settings.quickPrompts.hiddenBuiltInIds.filter(
			(id) => id !== promptId,
		);
		this.plugin.settings.quickPrompts.builtInOverrides = this.plugin.settings.quickPrompts.builtInOverrides.filter(
			(item) => item.id !== promptId,
		);
	}

	private hideBuiltInPrompt(promptId: string): void {
		if (!this.plugin.settings.quickPrompts.hiddenBuiltInIds.includes(promptId)) {
			this.plugin.settings.quickPrompts.hiddenBuiltInIds.push(promptId);
		}

		this.plugin.settings.quickPrompts.builtInOverrides = this.plugin.settings.quickPrompts.builtInOverrides.filter(
			(item) => item.id !== promptId,
		);
	}

	private renderCliSettings(containerEl: HTMLElement, providerId: CliProviderId, t: Translator): void {
		const cliLabel = providerId === "gemini-cli"
			? t("settings.provider.geminiCli")
			: t("settings.provider.codexCli");
		const config = this.getCliConfig(providerId);

		new Setting(containerEl)
			.setName(cliLabel)
			.setDesc(t("settings.cli.block.desc"))
			.addButton((button) => {
				button.setButtonText(t("settings.cli.useLocalPreset"));
				button.onClick(async () => {
					if (providerId === "gemini-cli") {
						config.executablePath = "gemini";
						config.argsJson = "[]";
					} else {
						config.executablePath = "codex";
						config.argsJson = "[\"exec\", \"--skip-git-repo-check\"]";
					}

					await this.plugin.saveSettings();
					this.display();
				});
			})
			.addButton((button) => {
				button.setButtonText(t("settings.cli.useNpxPreset"));
				button.onClick(async () => {
					applyNpxPreset(providerId, config);

					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(t("settings.cli.path.name"))
			.setDesc(t("settings.cli.path.desc"))
			.addText((text) => {
				text
					.setValue(config.executablePath)
					.onChange((value) => {
						config.executablePath = value;
						config.argsJson = normalizeCliArgsForExecutable(providerId, value, config.argsJson);
						this.scheduleSave();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.cli.arguments.name"))
			.setDesc(t("settings.cli.arguments.desc"))
			.addTextArea((textArea) => {
				textArea.inputEl.rows = 3;
				textArea
					.setValue(config.argsJson)
					.onChange((value) => {
						config.argsJson = value;
						this.scheduleSave();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.cli.timeout.name"))
			.setDesc(t("settings.cli.timeout.desc"))
			.addText((text) => {
				text
					.setValue(String(config.timeoutMs))
					.onChange((value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isFinite(parsed) || parsed <= 0) {
							return;
						}

						config.timeoutMs = parsed;
						this.scheduleSave();
					});
			});
	}

	private renderApiSettings(
		containerEl: HTMLElement,
		providerId: ApiProviderId,
		t: Translator,
	): void {
		this.ensureModelsLoaded(providerId);
		const config = this.getApiConfig(providerId);

		const tokenSetting = new Setting(containerEl)
			.setName(t("settings.api.token.name"))
			.setDesc(getTokenDescription(config.endpoint, t))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(t("settings.api.token.placeholder"))
					.setValue(config.apiToken)
					.onChange((value) => {
						config.apiToken = value;
						this.scheduleSave();
						this.scheduleModelsRefresh(providerId);
					});
			});

		new Setting(containerEl)
			.setName(t("settings.api.endpoint.name"))
			.setDesc(t("settings.api.endpoint.desc"))
			.addText((text) => {
				text
					.setValue(config.endpoint)
					.onChange((value) => {
						config.endpoint = value;
						this.scheduleSave();
						this.scheduleModelsRefresh(providerId);
						tokenSetting.setDesc(getTokenDescription(config.endpoint, t));
					});
			});

		this.renderModelInput(containerEl, providerId, config, t);
	}

	private renderOllamaSettings(containerEl: HTMLElement, t: Translator): void {
		const providerId: LocalProviderId = "ollama-local";
		this.ensureModelsLoaded(providerId);
		const config = this.plugin.settings.ollamaLocal;

		new Setting(containerEl)
			.setName(t("settings.api.endpoint.name"))
			.setDesc(t("settings.api.endpoint.desc"))
			.addText((text) => {
				text
					.setValue(config.endpoint)
					.onChange((value) => {
						config.endpoint = value;
						this.scheduleSave();
						this.scheduleModelsRefresh(providerId);
					});
			});

		this.renderModelInput(containerEl, providerId, config, t);
	}

	private renderModelInput(
		containerEl: HTMLElement,
		providerId: ModelDiscoverProviderId,
		config: { model: string },
		t: Translator,
	): void {
		const setting = new Setting(containerEl).setName(t("settings.api.model.name"));

		const listId = `ai-refiner-models-${providerId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
		const datalist = containerEl.createEl("datalist");
		datalist.id = listId;

		setting.addText((text) => {
			text.inputEl.setAttribute("list", listId);
			text
				.setValue(config.model)
				.onChange((value) => {
					config.model = value;
					this.scheduleSave();
				});

			this.modelUiRefs.set(providerId, {
				statusEl: setting.descEl,
				inputEl: text.inputEl,
				datalistEl: datalist,
			});
			this.updateModelUi(providerId, t);
		});
	}

	private updateModelUi(providerId: ModelDiscoverProviderId, t: Translator): void {
		const refs = this.modelUiRefs.get(providerId);
		if (!refs) {
			return;
		}

		const isLoading = this.modelDetectionInProgress.has(providerId);
		const availableModels = this.getAvailableModels(providerId);
		refs.statusEl.setText(
			`${t("settings.api.model.desc")} ${this.getModelStatusDescription(providerId, availableModels.length, isLoading, t)}`,
		);
		refs.inputEl.placeholder = isLoading
			? t("settings.api.detectModels.loading")
			: t("settings.api.model.placeholder");

		refs.datalistEl.empty();
		for (const modelId of uniqueNonEmpty(availableModels)) {
			refs.datalistEl.createEl("option", { value: modelId });
		}
	}

	private async detectModels(providerId: ModelDiscoverProviderId): Promise<void> {
		if (this.modelDetectionInProgress.has(providerId)) {
			return;
		}

		const cacheKey = this.getModelCacheKey(providerId);
		if (this.modelCacheKey.get(providerId) === cacheKey) {
			return;
		}
		const failureKey = this.modelFailureKey.get(providerId);
		const lastFailureAt = this.modelLastFailureAt.get(providerId) ?? 0;
		if (failureKey === cacheKey && Date.now() - lastFailureAt < MODEL_RETRY_COOLDOWN_MS) {
			return;
		}

		const t = this.getTranslator();
		this.modelDetectionInProgress.add(providerId);
		this.updateModelUi(providerId, t);
		try {
			const models = await this.fetchModels(providerId);
			this.detectedModels.set(providerId, models);
			this.modelCacheKey.set(providerId, cacheKey);
			this.modelFailureKey.delete(providerId);
			this.modelLastFailureAt.delete(providerId);
			this.modelLastError.delete(providerId);

			const activeConfig = this.getProviderConfig(providerId);
			const [firstModel] = models;
			if (!activeConfig.model.trim() && firstModel) {
				activeConfig.model = firstModel;
				const refs = this.modelUiRefs.get(providerId);
				if (refs) {
					refs.inputEl.value = firstModel;
				}
				this.scheduleSave();
			}
		} catch (error: unknown) {
			this.detectedModels.set(providerId, []);
			this.modelCacheKey.delete(providerId);
			this.modelFailureKey.set(providerId, cacheKey);
			this.modelLastFailureAt.set(providerId, Date.now());
			this.modelLastError.set(providerId, getErrorMessage(error));
		} finally {
			this.modelDetectionInProgress.delete(providerId);
			this.updateModelUi(providerId, t);
		}
	}

	private getAvailableModels(providerId: ModelDiscoverProviderId): string[] {
		return this.detectedModels.get(providerId) ?? [];
	}

	private getModelStatusDescription(
		providerId: ModelDiscoverProviderId,
		availableCount: number,
		isLoading: boolean,
		t: Translator,
	): string {
		if (isLoading) {
			return t("settings.api.model.status.loading");
		}

		const error = this.modelLastError.get(providerId);
		if (error) {
			return `${t("settings.api.model.status.error")} (${truncate(error, 70)})`;
		}

		if (availableCount > 0) {
			return t("settings.api.model.status.loaded").replace("{count}", String(availableCount));
		}

		return t("settings.api.model.status.none");
	}

	private async fetchModels(providerId: ModelDiscoverProviderId): Promise<string[]> {
		if (providerId === "ollama-local") {
			return discoverOllamaModels(this.plugin.settings.ollamaLocal);
		}
		return discoverModelsForProvider(this.getApiConfig(providerId));
	}

	private getProviderConfig(providerId: ModelDiscoverProviderId): { endpoint: string; model: string } {
		if (providerId === "ollama-local") {
			return this.plugin.settings.ollamaLocal;
		}
		return this.getApiConfig(providerId);
	}

	private ensureModelsLoaded(providerId: ModelDiscoverProviderId): void {
		const cacheKey = this.getModelCacheKey(providerId);
		if (this.modelCacheKey.get(providerId) === cacheKey) {
			return;
		}
		if (this.modelDetectionInProgress.has(providerId)) {
			return;
		}
		const failureKey = this.modelFailureKey.get(providerId);
		const lastFailureAt = this.modelLastFailureAt.get(providerId) ?? 0;
		if (failureKey === cacheKey && Date.now() - lastFailureAt < MODEL_RETRY_COOLDOWN_MS) {
			return;
		}
		void this.detectModels(providerId);
	}

	private invalidateModelCache(providerId: ModelDiscoverProviderId): void {
		this.modelCacheKey.delete(providerId);
		this.detectedModels.delete(providerId);
		this.modelFailureKey.delete(providerId);
		this.modelLastFailureAt.delete(providerId);
		this.modelLastError.delete(providerId);
	}

	private scheduleModelsRefresh(providerId: ModelDiscoverProviderId): void {
		this.invalidateModelCache(providerId);
		const previousTimer = this.modelRefreshTimers.get(providerId);
		if (typeof previousTimer === "number") {
			window.clearTimeout(previousTimer);
		}

		const timerId = window.setTimeout(() => {
			this.modelRefreshTimers.delete(providerId);
			void this.detectModels(providerId);
		}, 450);
		this.modelRefreshTimers.set(providerId, timerId);
	}

	private getModelCacheKey(providerId: ModelDiscoverProviderId): string {
		if (providerId === "ollama-local") {
			return `ollama:${this.plugin.settings.ollamaLocal.endpoint.trim().toLowerCase()}`;
		}

		const config = this.getApiConfig(providerId);
		return [
			providerId,
			config.endpoint.trim().toLowerCase(),
			config.apiToken.trim(),
		].join("|");
	}

	private getCliConfig(providerId: CliProviderId): AIRefinerSettings["geminiCli"] | AIRefinerSettings["codexCli"] {
		return providerId === "gemini-cli" ? this.plugin.settings.geminiCli : this.plugin.settings.codexCli;
	}

	private getApiConfig(providerId: ApiProviderId): AIRefinerSettings["customApi"] {
		switch (providerId) {
			case "custom-api":
				return this.plugin.settings.customApi;
			default:
				return assertNever(providerId);
		}
	}

	private getProviderLabel(providerId: ProviderId, t: Translator): string {
		switch (providerId) {
			case "gemini-cli":
				return t("settings.provider.geminiCli");
			case "codex-cli":
				return t("settings.provider.codexCli");
			case "ollama-local":
				return t("settings.provider.ollamaLocal");
			case "custom-api":
				return t("settings.provider.customApi");
			default:
				return assertNever(providerId);
		}
	}

	hide(): void {
		// Cancel model-refresh timers and flush any debounced save so a closed
		// tab leaves no pending timers running and never loses the last edit.
		for (const timerId of this.modelRefreshTimers.values()) {
			window.clearTimeout(timerId);
		}
		this.modelRefreshTimers.clear();

		if (this.saveDebounceTimer !== null) {
			window.clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
			void this.plugin.saveSettings();
		}
	}

	private scheduleSave(): void {
		if (this.saveDebounceTimer !== null) {
			window.clearTimeout(this.saveDebounceTimer);
		}

		this.saveDebounceTimer = window.setTimeout(() => {
			this.saveDebounceTimer = null;
			void this.plugin.saveSettings();
		}, 220);
	}

	private getTranslator(): Translator {
		const resolvedLanguage = resolvePluginLanguage(
			this.plugin.settings.languageMode,
			this.plugin.settings.language,
			getLanguage(),
		);
		return createTranslator(resolvedLanguage);
	}
}

function isProviderId(value: string): value is ProviderId {
	return PROVIDER_ORDER.includes(value as ProviderId);
}

function isCliProviderId(value: ProviderId): value is CliProviderId {
	return value === "gemini-cli" || value === "codex-cli";
}

function isLanguageMode(value: string): value is LanguageMode {
	return value === "auto" || value === "manual";
}

function applyNpxPreset(
	providerId: CliProviderId,
	config: AIRefinerSettings["geminiCli"] | AIRefinerSettings["codexCli"],
): void {
	config.executablePath = "npx";
	config.argsJson = NPX_PRESETS[providerId].npxArgsJson;
}

function getTokenDescription(endpoint: string, t: Translator): string {
	return isLocalEndpoint(endpoint)
		? t("settings.api.token.descLocalOptional")
		: t("settings.api.token.desc");
}

function isLocalEndpoint(endpoint: string): boolean {
	try {
		return isPrivateHost(new URL(endpoint.trim()).hostname);
	} catch {
		return false;
	}
}

function uniqueNonEmpty(items: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "Unknown error";
}

function truncate(value: string, maxLength: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
}

function createCustomPromptId(): string {
	return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertNever(value: never): never {
	void value;
	throw new Error("Unsupported setting value.");
}
