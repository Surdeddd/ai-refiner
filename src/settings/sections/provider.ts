import { Setting } from "obsidian";
import type { Translator } from "../../i18n";
import {
	PROVIDER_ORDER,
	getEffectiveProviderForCurrentPlatform,
	getSupportedProvidersForCurrentPlatform,
} from "../../providers/providerAvailability";
import { normalizeCliArgsForExecutable } from "../../providers/cliPresets";
import { getProviderLabel } from "../providerLabels";
import { isPrivateHost } from "../../utils/api";
import type { DiscoveryProviderId } from "../modelDiscovery";
import type { AIRefinerSettings, ApiProviderId, CliProviderId, ProviderId } from "../types";
import type { SettingsSectionContext } from "./context";

export function renderProviderSection(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const supportedProviders = getSupportedProvidersForCurrentPlatform(PROVIDER_ORDER);
	// Display the platform-effective provider WITHOUT persisting it: opening settings
	// on mobile must not overwrite a stored desktop CLI preference. Only an explicit
	// dropdown change saves.
	const activeProvider = getEffectiveProviderForCurrentPlatform(
		ctx.settings.activeProvider,
		PROVIDER_ORDER,
	);

	new Setting(containerEl)
		.setName(t("settings.provider.name"))
		.setDesc(t("settings.provider.desc"))
		.addDropdown((dropdown) => {
			for (const providerId of supportedProviders) {
				dropdown.addOption(providerId, getProviderLabel(providerId, t));
			}

			dropdown.setValue(activeProvider);
			dropdown.onChange(async (value) => {
				if (!isProviderId(value)) {
					return;
				}

				ctx.settings.activeProvider = value;
				await ctx.saveNow();
				ctx.rerender();
			});
		});
}

export function renderActiveProviderConfig(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const activeProvider = getEffectiveProviderForCurrentPlatform(
		ctx.settings.activeProvider,
		PROVIDER_ORDER,
	);

	if (isCliProviderId(activeProvider)) {
		renderCliConfig(containerEl, activeProvider, ctx);
	} else if (activeProvider === "ollama-local") {
		renderOllamaConfig(containerEl, ctx);
	} else {
		renderApiConfig(containerEl, activeProvider, ctx);
	}
}

function renderCliConfig(containerEl: HTMLElement, providerId: CliProviderId, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const cliLabel = providerId === "gemini-cli"
		? t("settings.provider.geminiCli")
		: t("settings.provider.codexCli");
	const config = getCliConfig(ctx.settings, providerId);

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

				await ctx.saveNow();
				ctx.rerender();
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
					ctx.scheduleSave();
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
					ctx.scheduleSave();
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
					ctx.scheduleSave();
				});
		});
}

function renderApiConfig(containerEl: HTMLElement, providerId: ApiProviderId, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const config = ctx.settings.customApi;

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
					ctx.scheduleSave();
					// Credentials changed: any in-flight or displayed discovery
					// result no longer matches them. No automatic re-fetch.
					ctx.discovery.invalidate(providerId);
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
					ctx.scheduleSave();
					ctx.discovery.invalidate(providerId);
					tokenSetting.setDesc(getTokenDescription(config.endpoint, t));
				});
		});

	renderModelInput(containerEl, providerId, config, ctx);
}

function renderOllamaConfig(containerEl: HTMLElement, ctx: SettingsSectionContext): void {
	const { t } = ctx;
	const providerId: DiscoveryProviderId = "ollama-local";
	const config = ctx.settings.ollamaLocal;

	new Setting(containerEl)
		.setName(t("settings.api.endpoint.name"))
		.setDesc(t("settings.api.endpoint.desc"))
		.addText((text) => {
			text
				.setValue(config.endpoint)
				.onChange((value) => {
					config.endpoint = value;
					ctx.scheduleSave();
					ctx.discovery.invalidate(providerId);
				});
		});

	renderModelInput(containerEl, providerId, config, ctx);
}

function renderModelInput(
	containerEl: HTMLElement,
	providerId: DiscoveryProviderId,
	config: { model: string },
	ctx: SettingsSectionContext,
): void {
	const { t } = ctx;
	const setting = new Setting(containerEl).setName(t("settings.api.model.name"));

	const listId = `ai-refiner-models-${providerId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
	const datalist = containerEl.createEl("datalist");
	datalist.id = listId;

	let inputEl: HTMLInputElement | null = null;
	setting.addText((text) => {
		text.inputEl.setAttribute("list", listId);
		text
			.setValue(config.model)
			.onChange((value) => {
				config.model = value;
				ctx.scheduleSave();
			});
		inputEl = text.inputEl;
	});

	// Discovery is strictly user-initiated: this button is the only trigger.
	setting.addButton((button) => {
		button.setButtonText(t("settings.api.detectModels.button"));
		button.onClick(() => {
			void ctx.discovery.detect(providerId).then(() => {
				const state = ctx.discovery.getState(providerId);
				const [firstModel] = state.models;
				if (state.phase === "loaded" && firstModel && !config.model.trim()) {
					config.model = firstModel;
					if (inputEl) {
						inputEl.value = firstModel;
					}
					ctx.scheduleSave();
				}
			});
		});

		if (inputEl) {
			ctx.registerModelUi(providerId, {
				statusEl: setting.descEl,
				inputEl,
				datalistEl: datalist,
				detectButtonEl: button.buttonEl,
			});
		}
		ctx.updateModelUi(providerId);
	});
}

function getCliConfig(
	settings: AIRefinerSettings,
	providerId: CliProviderId,
): AIRefinerSettings["geminiCli"] | AIRefinerSettings["codexCli"] {
	return providerId === "gemini-cli" ? settings.geminiCli : settings.codexCli;
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

function isProviderId(value: string): value is ProviderId {
	return PROVIDER_ORDER.includes(value as ProviderId);
}

function isCliProviderId(value: ProviderId): value is CliProviderId {
	return value === "gemini-cli" || value === "codex-cli";
}

