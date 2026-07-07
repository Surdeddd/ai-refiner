import { App, type Editor, type EditorPosition, MarkdownView } from "obsidian";
import type { FloatingAnchor, FloatingBounds } from "../ui/FloatingInput";

interface EditorWithCursorCoords extends Editor {
	cursorCoords?: (position?: EditorPosition, mode?: "page" | "window" | "local") => unknown;
	cm?: {
		coordsAtPos?: (offset: number, side?: -1 | 1) => unknown;
		cursorCoords?: (position?: EditorPosition, mode?: "page" | "window" | "local") => unknown;
		dom?: HTMLElement;
	};
}

export interface ActiveMarkdownEditor {
	view: MarkdownView;
	editor: Editor;
}

export function getActiveMarkdownEditor(app: App): ActiveMarkdownEditor | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		return null;
	}

	return {
		view,
		editor: view.editor,
	};
}

export function hasSelectedText(editor: Editor): boolean {
	return editor.somethingSelected();
}

export function getCursorCoords(editor: Editor, side: "from" | "to" = "to"): FloatingAnchor | null {
	return getPositionCoords(editor, editor.getCursor(side));
}

export function getPositionCoords(editor: Editor, position: EditorPosition): FloatingAnchor | null {
	const editorWithCoords = editor as EditorWithCursorCoords;

	if (editorWithCoords.cm && typeof editorWithCoords.cm.coordsAtPos === "function") {
		const offset = editor.posToOffset(position);
		const rect = editorWithCoords.cm.coordsAtPos(offset, 1);
		if (isRectLike(rect)) {
			return {
				left: rect.left + window.scrollX,
				top: rect.top + window.scrollY,
				bottom: rect.bottom + window.scrollY,
			};
		}
	}

	if (typeof editorWithCoords.cursorCoords === "function") {
		const coords = editorWithCoords.cursorCoords(position, "page");
		if (isFloatingAnchor(coords)) {
			return coords;
		}
	}

	if (editorWithCoords.cm && typeof editorWithCoords.cm.cursorCoords === "function") {
		const coords = editorWithCoords.cm.cursorCoords(position, "page");
		if (isFloatingAnchor(coords)) {
			if (editorWithCoords.cm.dom) {
				const editorRect = editorWithCoords.cm.dom.getBoundingClientRect();
				const seemsLocal = coords.top <= editorRect.height && coords.left <= editorRect.width;
				if (seemsLocal) {
					return {
						left: editorRect.left + coords.left + window.scrollX,
						top: editorRect.top + coords.top + window.scrollY,
						bottom: editorRect.top + coords.bottom + window.scrollY,
					};
				}
			}

			return coords;
		}
	}

	return getSelectionCoordsFallback();
}

export function getEditorBounds(editor: Editor): FloatingBounds | null {
	const editorWithCoords = editor as EditorWithCursorCoords;
	const editorDom = editorWithCoords.cm?.dom;
	if (!editorDom) {
		return null;
	}

	const rect = editorDom.getBoundingClientRect();
	if (!isRectBoundsLike(rect)) {
		return null;
	}

	return {
		left: rect.left + window.scrollX,
		right: rect.right + window.scrollX,
		top: rect.top + window.scrollY,
		bottom: rect.bottom + window.scrollY,
	};
}

export function getEditorFloatingMount(editor: Editor): HTMLElement | null {
	const editorWithCoords = editor as EditorWithCursorCoords;
	const editorDom = editorWithCoords.cm?.dom;
	if (!editorDom) {
		return null;
	}

	const sourceViewEl = editorDom.closest(".markdown-source-view");
	if (sourceViewEl instanceof HTMLElement) {
		return sourceViewEl;
	}

	const leafContentEl = editorDom.closest(".workspace-leaf-content");
	if (leafContentEl instanceof HTMLElement) {
		return leafContentEl;
	}

	return editorDom.parentElement;
}

function isFloatingAnchor(value: unknown): value is FloatingAnchor {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const anchor = value as Partial<FloatingAnchor>;
	return isFiniteNumber(anchor.left) && isFiniteNumber(anchor.top) && isFiniteNumber(anchor.bottom);
}

function getSelectionCoordsFallback(): FloatingAnchor | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const range = selection.getRangeAt(selection.rangeCount - 1);
	const rect = range.getBoundingClientRect();
	if (!isFiniteNumber(rect.left) || !isFiniteNumber(rect.top) || !isFiniteNumber(rect.bottom)) {
		return null;
	}

	return {
		left: rect.left + window.scrollX,
		top: rect.top + window.scrollY,
		bottom: rect.bottom + window.scrollY,
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRectLike(value: unknown): value is { left: number; top: number; bottom: number } {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const rect = value as { left?: unknown; top?: unknown; bottom?: unknown };
	return isFiniteNumber(rect.left) && isFiniteNumber(rect.top) && isFiniteNumber(rect.bottom);
}

function isRectBoundsLike(value: unknown): value is { left: number; top: number; right: number; bottom: number } {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const rect = value as { left?: unknown; top?: unknown; right?: unknown; bottom?: unknown };
	return isFiniteNumber(rect.left) && isFiniteNumber(rect.top) && isFiniteNumber(rect.right)
		&& isFiniteNumber(rect.bottom);
}
