import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
import {
	getEffectiveProviderForCurrentPlatform,
	getSupportedProvidersForCurrentPlatform,
	isProviderSupportedOnCurrentPlatform,
} from "../src/providers/providerAvailability";
import { ProviderFactory } from "../src/providers/ProviderFactory";
import { HttpApiProvider } from "../src/providers/HttpApiProvider";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";

const setPlatform = (desktop: boolean): void => {
	Platform.isDesktopApp = desktop;
	Platform.isMobileApp = !desktop;
	Platform.isDesktop = desktop;
	Platform.isMobile = !desktop;
};

afterEach(() => {
	setPlatform(true);
});

describe("getEffectiveProviderForCurrentPlatform", () => {
	it("keeps a CLI provider on desktop", () => {
		setPlatform(true);
		expect(getEffectiveProviderForCurrentPlatform("codex-cli")).toBe("codex-cli");
	});

	it("falls back to an API provider on mobile without touching the input", () => {
		setPlatform(false);
		expect(getEffectiveProviderForCurrentPlatform("codex-cli")).toBe("custom-api");
		expect(getEffectiveProviderForCurrentPlatform("gemini-cli")).toBe("custom-api");
		expect(getEffectiveProviderForCurrentPlatform("ollama-local")).toBe("ollama-local");
		expect(getEffectiveProviderForCurrentPlatform("custom-api")).toBe("custom-api");
	});

	it("survives a desktop -> mobile -> desktop round trip with the stored value intact", () => {
		const settings = mergeSettings({ ...DEFAULT_SETTINGS, activeProvider: "codex-cli" });

		setPlatform(true);
		expect(getEffectiveProviderForCurrentPlatform(settings.activeProvider)).toBe("codex-cli");

		// Mobile session: effective provider changes, stored preference must not.
		setPlatform(false);
		expect(getEffectiveProviderForCurrentPlatform(settings.activeProvider)).toBe("custom-api");
		expect(settings.activeProvider).toBe("codex-cli");

		// Back on desktop the original choice is still in force.
		setPlatform(true);
		expect(getEffectiveProviderForCurrentPlatform(settings.activeProvider)).toBe("codex-cli");
	});
});

describe("ProviderFactory platform resolution", () => {
	it("creates the fallback API provider on mobile and never mutates settings", () => {
		setPlatform(false);
		const settings = mergeSettings({ ...DEFAULT_SETTINGS, activeProvider: "codex-cli" });
		const provider = new ProviderFactory().create(settings);

		expect(provider).toBeInstanceOf(HttpApiProvider);
		expect(settings.activeProvider).toBe("codex-cli");
	});
});

describe("supported provider lists", () => {
	it("hides CLI providers on mobile only", () => {
		setPlatform(false);
		expect(getSupportedProvidersForCurrentPlatform()).toEqual(["ollama-local", "custom-api"]);
		expect(isProviderSupportedOnCurrentPlatform("codex-cli")).toBe(false);

		setPlatform(true);
		expect(getSupportedProvidersForCurrentPlatform()).toEqual([
			"gemini-cli",
			"codex-cli",
			"ollama-local",
			"custom-api",
		]);
	});
});
