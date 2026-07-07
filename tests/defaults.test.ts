import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";

describe("mergeSettings", () => {
	it("returns defaults for null/undefined/empty input", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
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
