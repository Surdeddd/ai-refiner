import { Setting, getLanguage } from "obsidian";
import {
	getLanguageLabel,
	getSupportedLanguages,
	isPluginLanguage,
	resolvePluginLanguage,
} from "../../i18n";
import {
	formatHotkeyForDisplay,
	hotkeyComboFromKeyboardEvent,
	normalizeHotkeyCombo,
} from "../../utils/hotkey";
import type { LanguageMode } from "../types";
import type { SettingsSectionContext } from "./context";

export function renderGeneralSection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { settings, t } = ctx;

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
				.setValue(settings.languageMode)
				.onChange(async (value) => {
					if (!isLanguageMode(value)) {
						return;
					}

					settings.languageMode = value;
					await ctx.saveNow();
					ctx.rerender();
				});
		});

	if (settings.languageMode === "auto") {
		const currentLanguage = getLanguageLabel(
			resolvePluginLanguage("auto", settings.language, getLanguage()),
		);
		new Setting(containerEl)
			.setName(t("settings.language.autoDetected.name"))
			.setDesc(`${t("settings.language.autoDetected.desc")} ${currentLanguage}`);
	}

	if (settings.languageMode === "manual") {
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dropdown) => {
				for (const language of getSupportedLanguages()) {
					dropdown.addOption(language, getLanguageLabel(language));
				}

				dropdown.setValue(settings.language);
				dropdown.onChange(async (value) => {
					if (!isPluginLanguage(value)) {
						return;
					}

					settings.language = value;
					await ctx.saveNow();
					ctx.rerender();
				});
			});
	}
}

export function renderHotkeySection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const config = ctx.settings.hotkey;

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
					ctx.scheduleSave();
					return;
				}

				const nextCombo = hotkeyComboFromKeyboardEvent(event);
				if (!nextCombo) {
					return;
				}

				config.combo = normalizeHotkeyCombo(nextCombo);
				text.setValue(formatHotkeyForDisplay(config.combo));
				ctx.scheduleSave();
			});
		})
		.addButton((button) => {
			button.setButtonText(t("settings.hotkey.clear"));
			button.onClick(() => {
				config.combo = "";
				ctx.scheduleSave();
				ctx.rerender();
			});
		});
}

function isLanguageMode(value: string): value is LanguageMode {
	return value === "auto" || value === "manual";
}
