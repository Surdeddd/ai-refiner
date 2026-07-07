import { describe, expect, it } from "vitest";
import {
	formatHotkeyForDisplay,
	matchesHotkeyEvent,
	normalizeHotkeyCombo,
} from "../src/utils/hotkey";

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
	return {
		key: "a",
		code: "KeyA",
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		...init,
	} as KeyboardEvent;
}

describe("normalizeHotkeyCombo", () => {
	it("canonicalizes modifier order and aliases (keyboard-captured code form)", () => {
		expect(normalizeHotkeyCombo("shift + cmd + KeyP")).toBe("Meta+Shift+KeyP");
		expect(normalizeHotkeyCombo("control+alt+Delete")).toBe("Ctrl+Alt+Delete");
	});

	it("is idempotent on an already-canonical combo", () => {
		expect(normalizeHotkeyCombo("Meta+Shift+KeyP")).toBe("Meta+Shift+KeyP");
	});

	it("returns empty for combos without a non-modifier key or without modifiers", () => {
		expect(normalizeHotkeyCombo("ctrl")).toBe("");
		expect(normalizeHotkeyCombo("KeyP")).toBe("");
		expect(normalizeHotkeyCombo("")).toBe("");
	});
});

describe("formatHotkeyForDisplay", () => {
	it("renders a human label", () => {
		expect(formatHotkeyForDisplay("Meta+Shift+KeyP")).toBe("Meta + Shift + P");
	});
});

describe("matchesHotkeyEvent", () => {
	const combo = "Meta+Shift+KeyP";

	it("matches an exact modifier + code event", () => {
		expect(matchesHotkeyEvent(keyEvent({ code: "KeyP", metaKey: true, shiftKey: true }), combo)).toBe(true);
	});

	it("rejects when a modifier differs", () => {
		expect(matchesHotkeyEvent(keyEvent({ code: "KeyP", metaKey: true, shiftKey: false }), combo)).toBe(false);
		expect(matchesHotkeyEvent(keyEvent({ code: "KeyP", metaKey: true, shiftKey: true, ctrlKey: true }), combo)).toBe(false);
	});

	it("rejects key repeats", () => {
		expect(matchesHotkeyEvent(keyEvent({ code: "KeyP", metaKey: true, shiftKey: true, repeat: true }), combo)).toBe(false);
	});

	it("rejects a different key code", () => {
		expect(matchesHotkeyEvent(keyEvent({ code: "KeyQ", metaKey: true, shiftKey: true }), combo)).toBe(false);
	});
});
