import { Notice, Plugin, getLanguage } from "obsidian";
import { registerCommands } from "./commands/registerCommands";
import {
	createTranslator,
	mapPluginLanguageToSpeechLocale,
	resolvePluginLanguage,
	type TranslationKey,
	type Translator,
} from "./i18n";
import { getFallbackProviderForCurrentPlatform } from "./providers/providerAvailability";
import { RefineSelectionService } from "./services/RefineSelectionService";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings/defaults";
import { AIRefinerSettingTab } from "./settings/settings-tab";
import type { AIRefinerSettings } from "./settings/types";
import { matchesHotkeyEvent, shouldIgnoreGlobalHotkeyTarget } from "./utils/hotkey";
import { getActiveMarkdownEditor, hasSelectedText } from "./utils/editor";

export default class AIRefinerPlugin extends Plugin {
	settings: AIRefinerSettings = DEFAULT_SETTINGS;
	private refineSelectionService: RefineSelectionService | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		const supportedProvider = getFallbackProviderForCurrentPlatform(this.settings.activeProvider);
		if (supportedProvider !== this.settings.activeProvider) {
			this.settings.activeProvider = supportedProvider;
			await this.saveSettings();
		}

		this.refineSelectionService = new RefineSelectionService(
			() => this.settings,
			() => this.getTranslator(),
			() => this.getVoiceLocale(),
		);
		registerCommands(this, this.refineSelectionService, this.getTranslator());

		this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
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
		await this.saveData(this.settings);
	}

	private async loadSettings(): Promise<void> {
		const savedData: unknown = await this.loadData();
		this.settings = mergeSettings(savedData as Partial<AIRefinerSettings> | null | undefined);
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
