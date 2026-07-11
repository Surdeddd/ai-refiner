import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";
import { ProviderFactory } from "../src/providers/ProviderFactory";
import { HttpApiProvider } from "../src/providers/HttpApiProvider";
import { OllamaLocalProvider } from "../src/providers/OllamaLocalProvider";
import { CliProcessProvider } from "../src/providers/CliProcessProvider";
import { findQuickPromptForInstruction, resolveQuickPrompts } from "../src/prompts/quickPrompts";
import type { Translator } from "../src/i18n";

const t: Translator = ((key: string) => key) as Translator;

const setPlatform = (desktop: boolean): void => {
	Platform.isDesktopApp = desktop;
	Platform.isMobileApp = !desktop;
};

afterEach(() => {
	setPlatform(true);
});

describe("quick prompt override sanitizing (mergeSettings)", () => {
	it("keeps valid providerId/model and drops junk", () => {
		const settings = mergeSettings({
			...DEFAULT_SETTINGS,
			quickPrompts: {
				custom: [
					{ id: "a", label: "A", instruction: "do a", providerId: "ollama-local", model: " llama3.2 " },
					{ id: "b", label: "B", instruction: "do b", providerId: "not-a-provider", model: 42 },
				],
				builtInOverrides: [],
				hiddenBuiltInIds: [],
			},
		} as never);

		expect(settings.quickPrompts.custom[0]).toEqual({
			id: "a",
			label: "A",
			instruction: "do a",
			providerId: "ollama-local",
			model: "llama3.2",
		});
		expect(settings.quickPrompts.custom[1]).toEqual({ id: "b", label: "B", instruction: "do b" });
	});
});

describe("resolveQuickPrompts override plumbing", () => {
	it("carries routing fields for custom prompts and built-in overrides", () => {
		const prompts = resolveQuickPrompts(
			{
				custom: [{ id: "mine", label: "Mine", instruction: "custom work", providerId: "custom-api", model: "gpt-5" }],
				builtInOverrides: [{ id: "fix-grammar", label: "", instruction: "", providerId: "ollama-local" }],
				hiddenBuiltInIds: [],
			},
			t,
		);

		const builtIn = prompts.find((p) => p.id === "fix-grammar");
		expect(builtIn?.providerId).toBe("ollama-local");

		const custom = prompts.find((p) => p.id === "mine");
		expect(custom?.providerId).toBe("custom-api");
		expect(custom?.model).toBe("gpt-5");
	});
});

describe("findQuickPromptForInstruction", () => {
	const prompts = [
		{ id: "a", label: "A", instruction: "Fix grammar.", providerId: "ollama-local" as const },
		{ id: "b", label: "B", instruction: "Shorten." },
	];

	it("matches the exact (trimmed) instruction", () => {
		expect(findQuickPromptForInstruction(prompts, "  Fix grammar.  ")?.id).toBe("a");
	});

	it("returns null for edited instructions and empty input", () => {
		expect(findQuickPromptForInstruction(prompts, "Fix grammar, please.")).toBeNull();
		expect(findQuickPromptForInstruction(prompts, "  ")).toBeNull();
	});
});

describe("ProviderFactory override routing", () => {
	const settings = mergeSettings({ ...DEFAULT_SETTINGS, activeProvider: "custom-api" });

	it("routes to the overridden provider", () => {
		const provider = new ProviderFactory().create(settings, { providerId: "ollama-local" });
		expect(provider).toBeInstanceOf(OllamaLocalProvider);
	});

	it("applies the model override without touching stored settings", () => {
		const factory = new ProviderFactory();
		const provider = factory.create(settings, { providerId: "ollama-local", model: "phi4" });
		expect(provider).toBeInstanceOf(OllamaLocalProvider);
		expect(settings.ollamaLocal.model).toBe(DEFAULT_SETTINGS.ollamaLocal.model);
	});

	it("keeps CLI overrides on desktop and degrades them to API on mobile", () => {
		setPlatform(true);
		expect(new ProviderFactory().create(settings, { providerId: "codex-cli" }))
			.toBeInstanceOf(CliProcessProvider);

		setPlatform(false);
		expect(new ProviderFactory().create(settings, { providerId: "codex-cli" }))
			.toBeInstanceOf(HttpApiProvider);
		expect(settings.activeProvider).toBe("custom-api");
	});

	it("uses the global provider when no override is given", () => {
		expect(new ProviderFactory().create(settings, {})).toBeInstanceOf(HttpApiProvider);
	});
});
