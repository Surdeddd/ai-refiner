import { describe, expect, it } from "vitest";
import type { Editor } from "obsidian";
import {
	NOTE_CONTEXT_MAX_CHARS,
	extractNoteContext,
	extractParagraphContext,
	positionToOffset,
	sanitizeContextScope,
} from "../src/utils/context";
import { buildFinalInstruction, extractContextForScope } from "../src/services/RefineSelectionService";

describe("sanitizeContextScope", () => {
	it("accepts known scopes and falls back to selection", () => {
		expect(sanitizeContextScope("paragraph")).toBe("paragraph");
		expect(sanitizeContextScope("note")).toBe("note");
		expect(sanitizeContextScope("bogus")).toBe("selection");
		expect(sanitizeContextScope(undefined)).toBe("selection");
	});
});

describe("extractParagraphContext", () => {
	const lines = [
		"# Heading",
		"",
		"First paragraph line one.",
		"First paragraph line two.",
		"",
		"Second paragraph.",
	];

	it("expands to blank-line boundaries", () => {
		expect(extractParagraphContext(lines, 3, 3)).toBe(
			"First paragraph line one.\nFirst paragraph line two.",
		);
	});

	it("stays inside a single-line paragraph", () => {
		expect(extractParagraphContext(lines, 5, 5)).toBe("Second paragraph.");
	});

	it("spans multiple paragraphs when the selection does", () => {
		expect(extractParagraphContext(lines, 2, 5)).toBe(
			"First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.",
		);
	});

	it("clamps out-of-range lines", () => {
		expect(extractParagraphContext(lines, 99, 99)).toBe("Second paragraph.");
	});
});

describe("extractNoteContext", () => {
	it("returns small notes whole", () => {
		expect(extractNoteContext("short note", 0)).toBe("short note");
	});

	it("trims huge notes to a window around the selection", () => {
		const big = "x".repeat(NOTE_CONTEXT_MAX_CHARS * 3);
		const windowed = extractNoteContext(big, NOTE_CONTEXT_MAX_CHARS + 500);
		expect(windowed.length).toBe(NOTE_CONTEXT_MAX_CHARS);
	});

	it("anchors the window at the edges for selections near the start", () => {
		const big = "y".repeat(NOTE_CONTEXT_MAX_CHARS * 2);
		expect(extractNoteContext(big, 0).length).toBe(NOTE_CONTEXT_MAX_CHARS);
	});
});

describe("positionToOffset", () => {
	it("counts characters plus newlines", () => {
		expect(positionToOffset(["ab", "cd"], 1, 1)).toBe(4); // "ab\n" + 1
		expect(positionToOffset(["ab"], 0, 2)).toBe(2);
	});
});

function fakeEditor(noteText: string): Editor {
	return { getValue: () => noteText } as unknown as Editor;
}

describe("extractContextForScope", () => {
	const note = "Intro line.\n\nSelected sentence here.\nSame paragraph tail.\n\nOutro.";
	const snapshot = { text: "Selected sentence here.", from: { line: 2, ch: 0 }, to: { line: 2, ch: 23 } };

	it("selection scope sends no context", () => {
		expect(extractContextForScope(fakeEditor(note), snapshot, "selection")).toBeNull();
	});

	it("paragraph scope sends the surrounding paragraph", () => {
		expect(extractContextForScope(fakeEditor(note), snapshot, "paragraph")).toBe(
			"Selected sentence here.\nSame paragraph tail.",
		);
	});

	it("paragraph scope sends nothing when the selection IS the paragraph", () => {
		const soloNote = "Before.\n\nExactly this.\n\nAfter.";
		const soloSnapshot = { text: "Exactly this.", from: { line: 2, ch: 0 }, to: { line: 2, ch: 13 } };
		expect(extractContextForScope(fakeEditor(soloNote), soloSnapshot, "paragraph")).toBeNull();
	});

	it("note scope sends the whole note", () => {
		expect(extractContextForScope(fakeEditor(note), snapshot, "note")).toBe(note);
	});
});

describe("buildFinalInstruction with context", () => {
	it("omits the context block when there is none", () => {
		const instruction = buildFinalInstruction("", "Fix grammar", null);
		expect(instruction).not.toContain("Surrounding context");
		expect(instruction).toContain("Fix grammar");
		expect(instruction).toContain("Output requirements:");
	});

	it("appends the context block between instruction and output policy", () => {
		const instruction = buildFinalInstruction("Keep my tone.", "Fix grammar", "The paragraph.");
		expect(instruction.indexOf("Keep my tone.")).toBeLessThan(instruction.indexOf("Fix grammar"));
		expect(instruction).toContain("Surrounding context (reference only");
		expect(instruction.indexOf("The paragraph.")).toBeLessThan(instruction.indexOf("Output requirements:"));
	});
});
