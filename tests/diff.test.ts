import { describe, expect, it } from "vitest";
import { diffWords, type DiffSegment } from "../src/utils/diff";

function joined(segments: DiffSegment[], type: DiffSegment["type"]): string {
	return segments.filter((s) => s.type === type).map((s) => s.text).join("");
}

describe("diffWords", () => {
	it("returns a single equal segment for identical text", () => {
		expect(diffWords("same text", "same text")).toEqual([{ type: "equal", text: "same text" }]);
		expect(diffWords("", "")).toEqual([]);
	});

	it("marks a replaced word as removed + added", () => {
		const segments = diffWords("the quick brown fox", "the slow brown fox");
		expect(segments).not.toBeNull();
		expect(joined(segments ?? [], "removed")).toBe("quick");
		expect(joined(segments ?? [], "added")).toBe("slow");
		expect(joined(segments ?? [], "equal")).toContain("brown fox");
	});

	it("handles pure insertion and pure deletion", () => {
		const inserted = diffWords("a c", "a b c") ?? [];
		expect(joined(inserted, "added").trim()).toBe("b");
		expect(joined(inserted, "removed")).toBe("");

		const deleted = diffWords("a b c", "a c") ?? [];
		expect(joined(deleted, "removed").trim()).toBe("b");
		expect(joined(deleted, "added")).toBe("");
	});

	it("reconstructs before/after from the segments", () => {
		const before = "One two three four.\nSecond line here.";
		const after = "One 2 three four!\nSecond line was here.";
		const segments = diffWords(before, after) ?? [];

		const rebuiltBefore = segments.filter((s) => s.type !== "added").map((s) => s.text).join("");
		const rebuiltAfter = segments.filter((s) => s.type !== "removed").map((s) => s.text).join("");
		expect(rebuiltBefore).toBe(before);
		expect(rebuiltAfter).toBe(after);
	});

	it("merges adjacent segments of the same type", () => {
		const segments = diffWords("x", "completely different words") ?? [];
		expect(segments.filter((s) => s.type === "added")).toHaveLength(1);
	});

	it("bails out to null above the token budget", () => {
		const big = Array.from({ length: 400 }, (_v, i) => `word${i}`).join(" ");
		expect(diffWords(big, `${big} tail`, 100)).toBeNull();
	});
});
