import type { PluginLanguage } from "../i18n";

export type LanguageMode = "auto" | "manual";
// "preview": show the result with Apply/Retry/Copy/Discard before touching the note;
// "replace": overwrite the selection as soon as the provider answers.
export type ResultMode = "preview" | "replace";
export type CliProviderId = "gemini-cli" | "codex-cli";
export type LocalProviderId = "ollama-local";
export type ApiProviderId = "custom-api";
export type ProviderId = CliProviderId | LocalProviderId | ApiProviderId;

export interface GeminiCliConfig {
	executablePath: string;
	argsJson: string;
	timeoutMs: number;
}

export interface CodexCliConfig {
	executablePath: string;
	argsJson: string;
	timeoutMs: number;
}

export interface HttpApiConfig {
	endpoint: string;
	model: string;
	apiToken: string;
}

export interface OllamaLocalConfig {
	endpoint: string;
	model: string;
}

export interface PromptConfig {
	prependInstruction: string;
}

export interface QuickPromptItem {
	id: string;
	label: string;
	instruction: string;
}

export interface QuickPromptsConfig {
	custom: QuickPromptItem[];
	builtInOverrides: QuickPromptItem[];
	hiddenBuiltInIds: string[];
}

export interface HotkeyConfig {
	combo: string;
}

export interface VoiceInputConfig {
	enabled: boolean;
	apiEndpoint: string;
	apiModel: string;
	apiToken: string;
}

export interface AIRefinerSettings {
	// Bumped when the persisted shape changes; drives migrations in mergeSettings.
	schemaVersion: number;
	languageMode: LanguageMode;
	language: PluginLanguage;
	resultMode: ResultMode;
	activeProvider: ProviderId;
	prompt: PromptConfig;
	quickPrompts: QuickPromptsConfig;
	hotkey: HotkeyConfig;
	voiceInput: VoiceInputConfig;
	geminiCli: GeminiCliConfig;
	codexCli: CodexCliConfig;
	ollamaLocal: OllamaLocalConfig;
	customApi: HttpApiConfig;
}
