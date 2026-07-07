import { describe, expect, it } from "vitest";
import type { Translator } from "../src/i18n";
import { BUILT_IN_QUICK_PROMPTS, resolveQuickPrompts } from "../src/prompts/quickPrompts";
import type { QuickPromptsConfig } from "../src/settings/types";

// Echoes the key back so tests can assert against stable identifiers.
const echo: Translator = ((key: string) => key) as Translator;

function config(overrides: Partial<QuickPromptsConfig> = {}): QuickPromptsConfig {
	return { custom: [], builtInOverrides: [], hiddenBuiltInIds: [], ...overrides };
}

describe("resolveQuickPrompts", () => {
	it("returns all built-ins by default in declared order", () => {
		const result = resolveQuickPrompts(config(), echo);
		expect(result.map((p) => p.id)).toEqual(BUILT_IN_QUICK_PROMPTS.map((p) => p.id));
	});

	it("hides built-ins listed in hiddenBuiltInIds", () => {
		const result = resolveQuickPrompts(config({ hiddenBuiltInIds: ["fix-grammar"] }), echo);
		expect(result.some((p) => p.id === "fix-grammar")).toBe(false);
	});

	it("applies non-empty overrides to a built-in", () => {
		const result = resolveQuickPrompts(
			config({ builtInOverrides: [{ id: "fix-grammar", label: "Custom", instruction: "Do it" }] }),
			echo,
		);
		const item = result.find((p) => p.id === "fix-grammar");
		expect(item?.label).toBe("Custom");
		expect(item?.instruction).toBe("Do it");
	});

	it("appends custom prompts after built-ins and dedupes by id", () => {
		const result = resolveQuickPrompts(
			config({
				custom: [
					{ id: "mine", label: "Mine", instruction: "Go" },
					{ id: "mine", label: "Dup", instruction: "Nope" },
					{ id: "blank", label: "", instruction: "x" },
				],
			}),
			echo,
		);
		const mine = result.filter((p) => p.id === "mine");
		expect(mine).toHaveLength(1);
		expect(result.some((p) => p.id === "blank")).toBe(false);
		expect(result[result.length - 1]?.id).toBe("mine");
	});
});
