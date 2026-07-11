import type { Translator } from "../../i18n";
import type { ModelDiscoveryController, DiscoveryProviderId } from "../modelDiscovery";
import type { AIRefinerSettings } from "../types";

export interface ModelUiRefs {
	statusEl: HTMLElement;
	inputEl: HTMLInputElement;
	datalistEl: HTMLElement;
	detectButtonEl: HTMLButtonElement;
}

// Narrow surface the section renderers get from the settings tab: mutate settings,
// persist (debounced or immediate), request a full re-render, and talk to the
// model-discovery controller. Sections never touch the tab instance directly.
export interface SettingsSectionContext {
	settings: AIRefinerSettings;
	t: Translator;
	scheduleSave(): void;
	saveNow(): Promise<void>;
	rerender(): void;
	discovery: ModelDiscoveryController;
	registerModelUi(providerId: DiscoveryProviderId, refs: ModelUiRefs): void;
	updateModelUi(providerId: DiscoveryProviderId): void;
}
