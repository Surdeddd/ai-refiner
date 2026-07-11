import { Setting } from "obsidian";
import type { SettingsSectionContext } from "./context";

export function renderVoiceSection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const config = ctx.settings.voiceInput;

	new Setting(containerEl)
		.setName(t("settings.voice.enabled.name"))
		.setDesc(t("settings.voice.enabled.desc"))
		.addToggle((toggle) => {
			toggle
				.setValue(config.enabled)
				.onChange((value) => {
					config.enabled = value;
					ctx.scheduleSave();
					ctx.rerender();
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
					ctx.scheduleSave();
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
					ctx.scheduleSave();
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
					ctx.scheduleSave();
				});
		});
}
