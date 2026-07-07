import { describe, expect, it } from "vitest";
import { isNpxExecutable, normalizeCliArgsForExecutable, NPX_PRESETS } from "../src/providers/cliPresets";

describe("isNpxExecutable", () => {
	it("matches bare npx and any path ending in /npx", () => {
		expect(isNpxExecutable("npx")).toBe(true);
		expect(isNpxExecutable("  npx  ")).toBe(true);
		expect(isNpxExecutable("/usr/local/bin/npx")).toBe(true);
		expect(isNpxExecutable("codex")).toBe(false);
		expect(isNpxExecutable("/opt/homebrew/bin/gemini")).toBe(false);
	});
});

describe("normalizeCliArgsForExecutable", () => {
	it("leaves args untouched for npx targets", () => {
		expect(normalizeCliArgsForExecutable("gemini-cli", "npx", NPX_PRESETS["gemini-cli"].npxArgsJson))
			.toBe(NPX_PRESETS["gemini-cli"].npxArgsJson);
	});

	it("strips the -y <package> prefix when switching gemini to a bare binary", () => {
		expect(normalizeCliArgsForExecutable("gemini-cli", "gemini", "[\"-y\", \"@google/gemini-cli\"]"))
			.toBe("[]");
	});

	it("keeps codex sub-args after stripping the -y <package> prefix", () => {
		expect(normalizeCliArgsForExecutable(
			"codex-cli",
			"codex",
			"[\"-y\", \"@openai/codex\", \"exec\", \"--skip-git-repo-check\"]",
		)).toBe("[\"exec\",\"--skip-git-repo-check\"]");
	});

	it("falls back to bare preset args when nothing remains after the prefix", () => {
		expect(normalizeCliArgsForExecutable("codex-cli", "codex", "[\"-y\", \"@openai/codex\"]"))
			.toBe(NPX_PRESETS["codex-cli"].bareArgsJson);
	});

	it("does not touch a non-preset args array", () => {
		expect(normalizeCliArgsForExecutable("gemini-cli", "gemini", "[\"chat\"]")).toBe("[\"chat\"]");
	});

	it("returns the original string on invalid JSON", () => {
		expect(normalizeCliArgsForExecutable("gemini-cli", "gemini", "not json")).toBe("not json");
	});
});
