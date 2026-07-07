import { isPluginLanguage } from "../i18n";
import type { AIRefinerSettings, ProviderId } from "./types";
import { normalizeHotkeyCombo } from "../utils/hotkey";
import { BUILT_IN_QUICK_PROMPTS } from "../prompts/quickPrompts";
import { VOICE_DEFAULT_ENDPOINT, VOICE_DEFAULT_MODEL } from "../voice/constants";

interface LegacySettingsShape extends Partial<AIRefinerSettings> {
	httpApi?: AIRefinerSettings["customApi"];
	openaiApi?: AIRefinerSettings["customApi"];
	openrouterApi?: AIRefinerSettings["customApi"];
	anthropicApi?: AIRefinerSettings["customApi"];
	googleApi?: AIRefinerSettings["customApi"];
	groqApi?: AIRefinerSettings["customApi"];
	xaiApi?: AIRefinerSettings["customApi"];
	deepseekApi?: AIRefinerSettings["customApi"];
}

const LEGACY_CUSTOM_API_PROVIDER_IDS = new Set([
	"openai-api",
	"openrouter-api",
	"anthropic-api",
	"google-api",
	"groq-api",
	"xai-api",
	"deepseek-api",
]);

const CUSTOM_API_PROVIDER_IDS = new Set(["custom-api", "http-api"]);

// Current persisted settings schema version. Bump when the shape changes and add
// a step to migrateRawSettings so older data.json files upgrade on load.
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: AIRefinerSettings = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	languageMode: "auto",
	language: "en",
	activeProvider: "gemini-cli",
	prompt: {
		prependInstruction: "",
	},
	quickPrompts: {
		custom: [],
		builtInOverrides: [],
		hiddenBuiltInIds: [],
	},
	hotkey: {
		combo: "",
	},
	voiceInput: {
		enabled: false,
		apiEndpoint: VOICE_DEFAULT_ENDPOINT,
		apiModel: VOICE_DEFAULT_MODEL,
		apiToken: "",
	},
	geminiCli: {
		executablePath: "gemini",
		argsJson: "[]",
		timeoutMs: 60_000,
	},
	codexCli: {
		executablePath: "codex",
		argsJson: "[\"exec\", \"--skip-git-repo-check\"]",
		timeoutMs: 60_000,
	},
	ollamaLocal: {
		endpoint: "http://127.0.0.1:11434",
		model: "llama3.2",
	},
	customApi: {
		endpoint: "https://api.openai.com/v1/chat/completions",
		model: "gpt-4o-mini",
		apiToken: "",
	},
};

export function mergeSettings(raw: Partial<AIRefinerSettings> | null | undefined): AIRefinerSettings {
	const migrated = migrateRawSettings(raw);
	const legacyRaw = migrated as LegacySettingsShape | null | undefined;
	const customApiRaw =
		legacyRaw?.customApi
		?? legacyRaw?.httpApi
		?? legacyRaw?.openaiApi
		?? legacyRaw?.openrouterApi
		?? legacyRaw?.anthropicApi
		?? legacyRaw?.googleApi
		?? legacyRaw?.groqApi
		?? legacyRaw?.xaiApi
		?? legacyRaw?.deepseekApi;

	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		languageMode: sanitizeLanguageMode(migrated?.languageMode),
		language: sanitizeLanguage(migrated?.language),
		activeProvider: getProviderId(migrated?.activeProvider),
		prompt: {
			prependInstruction: sanitizePrompt(migrated?.prompt?.prependInstruction),
		},
		quickPrompts: sanitizeQuickPrompts(migrated?.quickPrompts),
		hotkey: {
			combo: sanitizeHotkey(migrated?.hotkey?.combo),
		},
		voiceInput: {
			enabled: sanitizeBoolean(migrated?.voiceInput?.enabled, DEFAULT_SETTINGS.voiceInput.enabled),
			apiEndpoint: sanitizeEndpoint(migrated?.voiceInput?.apiEndpoint, DEFAULT_SETTINGS.voiceInput.apiEndpoint),
			apiModel: sanitizeModel(migrated?.voiceInput?.apiModel, DEFAULT_SETTINGS.voiceInput.apiModel),
			apiToken: sanitizeToken(migrated?.voiceInput?.apiToken),
		},
		geminiCli: {
			executablePath: migrated?.geminiCli?.executablePath ?? DEFAULT_SETTINGS.geminiCli.executablePath,
			argsJson: migrated?.geminiCli?.argsJson ?? DEFAULT_SETTINGS.geminiCli.argsJson,
			timeoutMs: sanitizeTimeout(migrated?.geminiCli?.timeoutMs),
		},
		codexCli: {
			executablePath: migrated?.codexCli?.executablePath ?? DEFAULT_SETTINGS.codexCli.executablePath,
			argsJson: migrated?.codexCli?.argsJson ?? DEFAULT_SETTINGS.codexCli.argsJson,
			timeoutMs: sanitizeTimeout(migrated?.codexCli?.timeoutMs),
		},
		ollamaLocal: {
			endpoint: sanitizeEndpoint(migrated?.ollamaLocal?.endpoint, DEFAULT_SETTINGS.ollamaLocal.endpoint),
			model: sanitizeModel(migrated?.ollamaLocal?.model, DEFAULT_SETTINGS.ollamaLocal.model),
		},
		customApi: mergeHttpConfig(customApiRaw, DEFAULT_SETTINGS.customApi),
	};
}

// Applies ordered, version-gated reshaping to a raw data.json object before it
// is sanitized. v1 is the first stamped schema, so there is nothing to upgrade
// yet; future shape changes add a step keyed on the stored schemaVersion.
function migrateRawSettings(
	raw: Partial<AIRefinerSettings> | null | undefined,
): Partial<AIRefinerSettings> | null | undefined {
	if (!isObjectLike(raw)) {
		return raw;
	}
	return raw;
}

function mergeHttpConfig(
	raw: Partial<AIRefinerSettings["customApi"]> | null | undefined,
	defaultValue: AIRefinerSettings["customApi"],
): AIRefinerSettings["customApi"] {
	return {
		endpoint: raw?.endpoint ?? defaultValue.endpoint,
		model: raw?.model ?? defaultValue.model,
		apiToken: raw?.apiToken ?? defaultValue.apiToken,
	};
}

function sanitizeLanguage(value: unknown): AIRefinerSettings["language"] {
	if (typeof value === "string" && isPluginLanguage(value)) {
		return value;
	}
	return DEFAULT_SETTINGS.language;
}

function sanitizeLanguageMode(value: unknown): AIRefinerSettings["languageMode"] {
	return value === "manual" ? "manual" : "auto";
}

function getProviderId(value: unknown): ProviderId {
	if (typeof value !== "string") {
		return "gemini-cli";
	}
	if (LEGACY_CUSTOM_API_PROVIDER_IDS.has(value)) {
		return "custom-api";
	}
	if (CUSTOM_API_PROVIDER_IDS.has(value)) {
		return "custom-api";
	}
	if (value === "ollama-local") {
		return "ollama-local";
	}
	if (value === "codex-cli") {
		return "codex-cli";
	}
	return "gemini-cli";
}

function sanitizeTimeout(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return DEFAULT_SETTINGS.geminiCli.timeoutMs;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function sanitizePrompt(value: unknown): string {
	return typeof value === "string" ? value : DEFAULT_SETTINGS.prompt.prependInstruction;
}

function sanitizeHotkey(value: unknown): string {
	if (typeof value !== "string") {
		return DEFAULT_SETTINGS.hotkey.combo;
	}
	return normalizeHotkeyCombo(value);
}

function sanitizeQuickPrompts(value: unknown): AIRefinerSettings["quickPrompts"] {
	if (!isObjectLike(value)) {
		return DEFAULT_SETTINGS.quickPrompts;
	}

	const raw = value as Partial<AIRefinerSettings["quickPrompts"]>;
	return {
		custom: sanitizeQuickPromptList(raw.custom, false),
		builtInOverrides: sanitizeQuickPromptList(raw.builtInOverrides, true),
		hiddenBuiltInIds: sanitizeHiddenBuiltInIds(raw.hiddenBuiltInIds),
	};
}

function sanitizeQuickPromptList(
	value: unknown,
	allowOnlyBuiltInIds: boolean,
): AIRefinerSettings["quickPrompts"]["custom"] {
	if (!Array.isArray(value)) {
		return [];
	}

	const result: AIRefinerSettings["quickPrompts"]["custom"] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isObjectLike(item)) {
			continue;
		}

		const id = sanitizePlainString(item.id);
		if (!id || seen.has(id)) {
			continue;
		}

		if (allowOnlyBuiltInIds && !BUILT_IN_QUICK_PROMPTS.some((builtIn) => builtIn.id === id)) {
			continue;
		}

		seen.add(id);
		result.push({
			id,
			label: sanitizePlainString(item.label),
			instruction: sanitizePlainString(item.instruction),
		});
	}
	return result;
}

function sanitizeHiddenBuiltInIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const allowed = new Set(BUILT_IN_QUICK_PROMPTS.map((item) => item.id));
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		const id = sanitizePlainString(item);
		if (!id || seen.has(id) || !allowed.has(id)) {
			continue;
		}

		seen.add(id);
		result.push(id);
	}
	return result;
}

function sanitizeToken(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function sanitizeEndpoint(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function sanitizeModel(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function sanitizePlainString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
