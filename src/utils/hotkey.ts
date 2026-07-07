const MODIFIER_ORDER = ["Ctrl", "Meta", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

interface ParsedHotkey {
	modifiers: Set<Modifier>;
	code: string;
}

export function normalizeHotkeyCombo(value: string): string {
	const parsed = parseHotkey(value);
	if (!parsed) {
		return "";
	}
	return serializeHotkey(parsed);
}

export function hotkeyComboFromKeyboardEvent(event: KeyboardEvent): string | null {
	if (isModifierKey(event.key)) {
		return null;
	}

	if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
		return null;
	}

	const code = normalizeCode(event.code, event.key);
	if (!code) {
		return null;
	}

	const modifiers = getModifiersFromEvent(event);
	return serializeHotkey({ modifiers, code });
}

export function formatHotkeyForDisplay(value: string): string {
	const parsed = parseHotkey(value);
	if (!parsed) {
		return "";
	}

	const modifierParts = MODIFIER_ORDER.filter((token) => parsed.modifiers.has(token));
	const keyLabel = codeToLabel(parsed.code);
	return [...modifierParts, keyLabel].join(" + ");
}

export function matchesHotkeyEvent(event: KeyboardEvent, combo: string): boolean {
	const parsed = parseHotkey(combo);
	if (!parsed) {
		return false;
	}

	if (event.repeat || isModifierKey(event.key)) {
		return false;
	}

	const code = normalizeCode(event.code, event.key);
	if (!code || code !== parsed.code) {
		return false;
	}

	return (
		event.ctrlKey === parsed.modifiers.has("Ctrl")
		&& event.metaKey === parsed.modifiers.has("Meta")
		&& event.altKey === parsed.modifiers.has("Alt")
		&& event.shiftKey === parsed.modifiers.has("Shift")
	);
}

export function shouldIgnoreGlobalHotkeyTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.closest(".cm-editor")) {
		return false;
	}

	if (target.isContentEditable) {
		return true;
	}

	const tagName = target.tagName.toLowerCase();
	return tagName === "input" || tagName === "textarea" || tagName === "select" || tagName === "button";
}

function parseHotkey(value: string): ParsedHotkey | null {
	const rawTokens = value
		.split("+")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (rawTokens.length < 2) {
		return null;
	}

	const modifiers = new Set<Modifier>();
	let code = "";
	for (const rawToken of rawTokens) {
		const modifier = normalizeModifier(rawToken);
		if (modifier) {
			modifiers.add(modifier);
			continue;
		}

		if (code) {
			return null;
		}

		code = normalizeCode(rawToken, rawToken);
	}

	if (!code || modifiers.size === 0) {
		return null;
	}

	return { modifiers, code };
}

function serializeHotkey(hotkey: ParsedHotkey): string {
	const modifierParts = MODIFIER_ORDER.filter((token) => hotkey.modifiers.has(token));
	return [...modifierParts, hotkey.code].join("+");
}

function getModifiersFromEvent(event: KeyboardEvent): Set<Modifier> {
	const modifiers = new Set<Modifier>();
	if (event.ctrlKey) {
		modifiers.add("Ctrl");
	}
	if (event.metaKey) {
		modifiers.add("Meta");
	}
	if (event.altKey) {
		modifiers.add("Alt");
	}
	if (event.shiftKey) {
		modifiers.add("Shift");
	}
	return modifiers;
}

function normalizeModifier(value: string): Modifier | null {
	const token = value.trim().toLowerCase();
	if (token === "ctrl" || token === "control") {
		return "Ctrl";
	}
	if (token === "meta" || token === "cmd" || token === "command") {
		return "Meta";
	}
	if (token === "alt" || token === "option") {
		return "Alt";
	}
	if (token === "shift") {
		return "Shift";
	}
	return null;
}

function normalizeCode(code: string, fallbackKey: string): string {
	const trimmedCode = code.trim();
	if (trimmedCode && trimmedCode !== "Unidentified") {
		return trimmedCode;
	}

	const key = fallbackKey.trim();
	if (!key) {
		return "";
	}

	if (key.length === 1) {
		const upper = key.toUpperCase();
		if (upper >= "A" && upper <= "Z") {
			return `Key${upper}`;
		}
		if (upper >= "0" && upper <= "9") {
			return `Digit${upper}`;
		}
	}

	const aliases: Record<string, string> = {
		" ": "Space",
		spacebar: "Space",
		enter: "Enter",
		tab: "Tab",
		escape: "Escape",
		esc: "Escape",
		backspace: "Backspace",
		delete: "Delete",
		insert: "Insert",
		home: "Home",
		end: "End",
		pageup: "PageUp",
		pagedown: "PageDown",
		arrowup: "ArrowUp",
		arrowdown: "ArrowDown",
		arrowleft: "ArrowLeft",
		arrowright: "ArrowRight",
		"-": "Minus",
		"=": "Equal",
		"[": "BracketLeft",
		"]": "BracketRight",
		";": "Semicolon",
		"'": "Quote",
		",": "Comma",
		".": "Period",
		"/": "Slash",
		"\\": "Backslash",
		"`": "Backquote",
	};

	const normalizedKey = key.toLowerCase();
	if (aliases[normalizedKey]) {
		return aliases[normalizedKey];
	}

	if (/^f\d{1,2}$/i.test(key)) {
		return key.toUpperCase();
	}

	return key;
}

function codeToLabel(code: string): string {
	if (code.startsWith("Key") && code.length === 4) {
		return code.slice(3);
	}
	if (code.startsWith("Digit") && code.length === 6) {
		return code.slice(5);
	}

	const labels: Record<string, string> = {
		Space: "Space",
		Minus: "-",
		Equal: "=",
		BracketLeft: "[",
		BracketRight: "]",
		Semicolon: ";",
		Quote: "'",
		Comma: ",",
		Period: ".",
		Slash: "/",
		Backslash: "\\",
		Backquote: "`",
	};

	return labels[code] ?? code;
}

function isModifierKey(key: string): boolean {
	const normalized = key.trim().toLowerCase();
	return (
		normalized === "control"
		|| normalized === "ctrl"
		|| normalized === "meta"
		|| normalized === "command"
		|| normalized === "alt"
		|| normalized === "option"
		|| normalized === "shift"
	);
}
