export type ContextScope = "selection" | "paragraph" | "note";

// A whole-note context larger than this is trimmed to a window around the selection —
// unbounded notes would blow up the prompt (and local-model context windows).
export const NOTE_CONTEXT_MAX_CHARS = 20_000;

export function sanitizeContextScope(value: unknown): ContextScope {
	return value === "paragraph" || value === "note" ? value : "selection";
}

// Returns the paragraph(s) containing the selection: expands from the selection's
// first/last line to the nearest blank lines (or document edges). Blank-line
// delimited paragraphs match how prose is written in Markdown.
export function extractParagraphContext(lines: string[], fromLine: number, toLine: number): string {
	const lastIndex = lines.length - 1;
	const startLine = Math.max(0, Math.min(fromLine, lastIndex));
	const endLine = Math.max(startLine, Math.min(toLine, lastIndex));

	let start = startLine;
	while (start > 0 && (lines[start - 1] ?? "").trim() !== "") {
		start -= 1;
	}

	let end = endLine;
	while (end < lastIndex && (lines[end + 1] ?? "").trim() !== "") {
		end += 1;
	}

	return lines.slice(start, end + 1).join("\n");
}

// Whole-note context, trimmed to a window around the selection when the note is
// huge. selectionOffset is the character offset of the selection start in noteText.
export function extractNoteContext(noteText: string, selectionOffset: number): string {
	if (noteText.length <= NOTE_CONTEXT_MAX_CHARS) {
		return noteText;
	}

	const half = Math.floor(NOTE_CONTEXT_MAX_CHARS / 2);
	const clampedOffset = Math.max(0, Math.min(selectionOffset, noteText.length));
	let start = Math.max(0, clampedOffset - half);
	const end = Math.min(noteText.length, start + NOTE_CONTEXT_MAX_CHARS);
	start = Math.max(0, end - NOTE_CONTEXT_MAX_CHARS);
	return noteText.slice(start, end);
}

// Character offset of a (line, ch) position within the joined lines text.
export function positionToOffset(lines: string[], line: number, ch: number): number {
	let offset = 0;
	const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
	for (let i = 0; i < clampedLine; i += 1) {
		offset += (lines[i] ?? "").length + 1; // +1 for the newline
	}
	return offset + Math.max(0, ch);
}
