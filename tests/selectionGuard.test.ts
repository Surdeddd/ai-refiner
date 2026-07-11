import { describe, expect, it, vi } from "vitest";
import type { Editor } from "obsidian";
import { replaceSnapshotSelection, type SelectionSnapshot } from "../src/services/RefineSelectionService";
import type { Translator } from "../src/i18n";

const t: Translator = ((key: string) => key) as Translator;

const SNAPSHOT: SelectionSnapshot = {
	text: "selected text",
	from: { line: 2, ch: 4 },
	to: { line: 2, ch: 17 },
};

function createEditor(currentRangeText: string) {
	return {
		getRange: vi.fn(() => currentRangeText),
		replaceRange: vi.fn(),
		setSelection: vi.fn(),
	};
}

describe("replaceSnapshotSelection (selection-changed guard)", () => {
	it("replaces and re-selects when the selection is unchanged", () => {
		const editor = createEditor(SNAPSHOT.text);

		replaceSnapshotSelection(editor as unknown as Editor, SNAPSHOT, "refined", t);

		expect(editor.replaceRange).toHaveBeenCalledWith("refined", SNAPSHOT.from, SNAPSHOT.to);
		// Single-line replacement: selection end is from.ch + inserted length.
		expect(editor.setSelection).toHaveBeenCalledWith(SNAPSHOT.from, { line: 2, ch: 4 + "refined".length });
	});

	it("throws and writes nothing when the document changed during the request", () => {
		const editor = createEditor("something else now");

		expect(() =>
			replaceSnapshotSelection(editor as unknown as Editor, SNAPSHOT, "refined", t),
		).toThrow("error.selectionChanged");
		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(editor.setSelection).not.toHaveBeenCalled();
	});

	it("computes the multi-line selection end from the last inserted line", () => {
		const editor = createEditor(SNAPSHOT.text);

		replaceSnapshotSelection(editor as unknown as Editor, SNAPSHOT, "line one\nline two", t);

		expect(editor.setSelection).toHaveBeenCalledWith(SNAPSHOT.from, { line: 3, ch: "line two".length });
	});
});
