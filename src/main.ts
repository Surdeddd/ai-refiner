import { Notice, Plugin, getLanguage } from "obsidian";
import { registerCommands } from "./commands/registerCommands";
import {
	createTranslator,
	mapPluginLanguageToSpeechLocale,
	resolvePluginLanguage,
	type TranslationKey,
	type Translator,
} from "./i18n";
import { RefineSelectionService } from "./services/RefineSelectionService";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings/defaults";
import { PluginSecretStore } from "./settings/secretStore";
import { AIRefinerSettingTab } from "./settings/settings-tab";
import type { AIRefinerSettings } from "./settings/types";
import { matchesHotkeyEvent, shouldIgnoreGlobalHotkeyTarget } from "./utils/hotkey";
import { getActiveMarkdownEditor, hasSelectedText } from "./utils/editor";

export default class AIRefinerPlugin extends Plugin {
	settings: AIRefinerSettings = DEFAULT_SETTINGS;
	private refineSelectionService: RefineSelectionService | null = null;
	private secretStore: PluginSecretStore | null = null;

	async onload(): Promise<void> {
		this.secretStore = new PluginSecretStore(this.app);
		await this.loadSettings();

		this.refineSelectionService = new RefineSelectionService(
			() => this.settings,
			() => this.getTranslator(),
			() => this.getVoiceLocale(),
			() => this.saveSettings(),
		);
		registerCommands(this, this.refineSelectionService, this.getTranslator());

		this.registerDomEvent(activeDocument, "keydown", (event: KeyboardEvent) => {
			void this.handleConfiguredHotkey(event);
		});

		this.addRibbonIcon("sparkles", this.t("ribbon.aiRefineSelection"), async () => {
			const activeEditor = getActiveMarkdownEditor(this.app);
			if (!activeEditor) {
				new Notice(this.t("notice.openNoteFirst"));
				return;
			}

			if (!hasSelectedText(activeEditor.editor)) {
				new Notice(this.t("notice.pleaseSelectTextFirst"));
				return;
			}

			await this.refineSelectionService?.run(activeEditor.editor, "ribbon");
		});

		this.addSettingTab(new AIRefinerSettingTab(this.app, this));
	}

	onunload(): void {
		this.refineSelectionService?.dispose();
		this.refineSelectionService = null;
	}

	async saveSettings(): Promise<void> {
		// On Obsidian 1.11.4+ tokens go to SecretStorage and are blanked in
		// data.json; older versions persist them as before.
		const persisted = this.secretStore?.prepareForPersistence(this.settings) ?? this.settings;
		await this.saveData(persisted);
	}

	private async loadSettings(): Promise<void> {
		const savedData: unknown = await this.loadData();
		this.settings = mergeSettings(savedData as Partial<AIRefinerSettings> | null | undefined);

		// Hydrate token values from SecretStorage; when data.json still carries
		// plaintext tokens, they are migrated in and the file is rewritten once.
		if (this.secretStore?.hydrateAndMigrate(this.settings)) {
			await this.saveSettings();
		}
	}

	private getTranslator(): Translator {
		const language = resolvePluginLanguage(this.settings.languageMode, this.settings.language, getLanguage());
		return createTranslator(language);
	}

	private t(key: TranslationKey): string {
		return this.getTranslator()(key);
	}

	private getVoiceLocale(): string {
		const language = resolvePluginLanguage(this.settings.languageMode, this.settings.language, getLanguage());
		return mapPluginLanguageToSpeechLocale(language);
	}

	private async handleConfiguredHotkey(event: KeyboardEvent): Promise<void> {
		const { hotkey } = this.settings;
		if (!hotkey.combo.trim()) {
			return;
		}

		if (event.defaultPrevented || shouldIgnoreGlobalHotkeyTarget(event.target)) {
			return;
		}

		if (!matchesHotkeyEvent(event, hotkey.combo)) {
			return;
		}

		const activeEditor = getActiveMarkdownEditor(this.app);
		if (!activeEditor) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		if (!hasSelectedText(activeEditor.editor)) {
			new Notice(this.t("notice.pleaseSelectTextFirst"));
			return;
		}

		await this.refineSelectionService?.run(activeEditor.editor, "hotkey");
	}
}
