import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";

describe("mergeSettings", () => {
	it("returns defaults for null/undefined input (fresh install)", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		// An existing data.json (even empty) predates v3: it keeps the historical
		// replace-immediately behavior instead of the new preview default.
		expect(mergeSettings({})).toEqual({ ...DEFAULT_SETTINGS, resultMode: "replace" });
	});

	it("resultMode: preview for fresh installs, replace for pre-v3 vaults, stored value wins", () => {
		expect(mergeSettings(null).resultMode).toBe("preview");
		expect(mergeSettings({ schemaVersion: 2 } as never).resultMode).toBe("replace");
		expect(mergeSettings({ schemaVersion: 3, resultMode: "replace" } as never).resultMode).toBe("replace");
		expect(mergeSettings({ schemaVersion: 2, resultMode: "preview" } as never).resultMode).toBe("preview");
		expect(mergeSettings({ schemaVersion: 3, resultMode: "bogus" } as never).resultMode).toBe("preview");
	});

	it("stamps the current schema version regardless of stored value", () => {
		expect(mergeSettings({}).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(mergeSettings({ schemaVersion: 0 } as never).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it("maps legacy provider ids onto custom-api", () => {
		for (const legacy of ["openai-api", "anthropic-api", "google-api", "http-api"]) {
			expect(mergeSettings({ activeProvider: legacy } as never).activeProvider).toBe("custom-api");
		}
	});

	it("keeps known provider ids", () => {
		for (const id of ["gemini-cli", "codex-cli", "ollama-local", "custom-api"] as const) {
			expect(mergeSettings({ activeProvider: id }).activeProvider).toBe(id);
		}
	});

	it("falls back to gemini-cli for unknown provider ids", () => {
		expect(mergeSettings({ activeProvider: "bogus" } as never).activeProvider).toBe("gemini-cli");
	});

	it("adopts legacy per-provider api config into customApi", () => {
		const merged = mergeSettings({
			httpApi: { endpoint: "https://legacy.example/v1/chat/completions", model: "m1", apiToken: "t" },
		} as never);
		expect(merged.customApi.endpoint).toBe("https://legacy.example/v1/chat/completions");
		expect(merged.customApi.model).toBe("m1");
		expect(merged.customApi.apiToken).toBe("t");
	});

	it("normalizes a stored hotkey combo", () => {
		expect(mergeSettings({ hotkey: { combo: "shift+cmd+KeyP" } }).hotkey.combo).toBe("Meta+Shift+KeyP");
	});

	it("coerces invalid timeouts to the default", () => {
		expect(mergeSettings({ geminiCli: { executablePath: "gemini", argsJson: "[]", timeoutMs: -1 } } as never)
			.geminiCli.timeoutMs).toBe(DEFAULT_SETTINGS.geminiCli.timeoutMs);
	});

	it("drops custom quick prompts with duplicate or empty ids", () => {
		const merged = mergeSettings({
			quickPrompts: {
				custom: [
					{ id: "x", label: "L", instruction: "I" },
					{ id: "x", label: "L2", instruction: "I2" },
					{ id: "", label: "L3", instruction: "I3" },
				],
				builtInOverrides: [],
				hiddenBuiltInIds: [],
			},
		} as never);
		expect(merged.quickPrompts.custom).toHaveLength(1);
		expect(merged.quickPrompts.custom[0]?.id).toBe("x");
	});

	it("keeps only real built-in ids in hiddenBuiltInIds", () => {
		const merged = mergeSettings({
			quickPrompts: { custom: [], builtInOverrides: [], hiddenBuiltInIds: ["fix-grammar", "not-real"] },
		} as never);
		expect(merged.quickPrompts.hiddenBuiltInIds).toEqual(["fix-grammar"]);
	});
});

describe("schema v2 migration: npx presets to bare binaries", () => {
	it("rewrites the recognized codex npx preset to the bare binary", () => {
		const settings = mergeSettings({
			schemaVersion: 1,
			codexCli: {
				executablePath: "npx",
				argsJson: "[\"-y\", \"@openai/codex\", \"exec\", \"--skip-git-repo-check\"]",
				timeoutMs: 60000,
			},
		} as never);

		expect(settings.codexCli.executablePath).toBe("codex");
		expect(settings.codexCli.argsJson).toBe("[\"exec\",\"--skip-git-repo-check\"]");
	});

	it("rewrites the recognized gemini npx preset to the bare binary", () => {
		const settings = mergeSettings({
			schemaVersion: 1,
			geminiCli: {
				executablePath: "npx",
				argsJson: "[\"-y\", \"@google/gemini-cli\"]",
				timeoutMs: 60000,
			},
		} as never);

		expect(settings.geminiCli.executablePath).toBe("gemini");
		expect(settings.geminiCli.argsJson).toBe("[]");
	});

	it("leaves a custom npx setup untouched", () => {
		const settings = mergeSettings({
			schemaVersion: 1,
			codexCli: {
				executablePath: "npx",
				argsJson: "[\"my-own-wrapper\", \"--flag\"]",
				timeoutMs: 60000,
			},
		} as never);

		expect(settings.codexCli.executablePath).toBe("npx");
		expect(settings.codexCli.argsJson).toBe("[\"my-own-wrapper\", \"--flag\"]");
	});

	it("does not touch bare-binary configs", () => {
		const settings = mergeSettings({
			schemaVersion: 1,
			codexCli: {
				executablePath: "/opt/homebrew/bin/codex",
				argsJson: "[\"exec\"]",
				timeoutMs: 60000,
			},
		} as never);

		expect(settings.codexCli.executablePath).toBe("/opt/homebrew/bin/codex");
		expect(settings.codexCli.argsJson).toBe("[\"exec\"]");
	});

	it("is idempotent for already-migrated (v2) data", () => {
		const migratedOnce = mergeSettings({
			schemaVersion: 1,
			codexCli: {
				executablePath: "npx",
				argsJson: "[\"-y\", \"@openai/codex\", \"exec\", \"--skip-git-repo-check\"]",
				timeoutMs: 60000,
			},
		} as never);
		const migratedTwice = mergeSettings(migratedOnce);

		expect(migratedTwice.codexCli).toEqual(migratedOnce.codexCli);
		expect(migratedTwice.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});
});
