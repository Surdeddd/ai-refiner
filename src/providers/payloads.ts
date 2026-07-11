import { SYSTEM_PROMPT, buildUserPrompt } from "./constants";

// Pure request-body/header builders for every HTTP backend. No I/O here — providers
// own transport and error mapping; tests assert the exact wire payloads.
// Invariant across all builders: SYSTEM_PROMPT travels in the system channel
// exactly once (or is prepended once for raw-prompt backends) and never leaks into
// the user prompt.

export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 8192;
export const GOOGLE_API_KEY_HEADER = "x-goog-api-key";

export function buildOpenAiCompatiblePayload(
	model: string,
	text: string,
	instruction: string,
): Record<string, unknown> {
	return {
		model,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserPrompt(instruction, text) },
		],
	};
}

export function buildOpenAiCompatibleHeaders(
	apiToken: string,
	options: { isOpenRouter: boolean },
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (apiToken) {
		headers["Authorization"] = `Bearer ${apiToken}`;
	}

	if (options.isOpenRouter) {
		headers["HTTP-Referer"] = "https://obsidian.md";
		headers["X-Title"] = "AI Refiner";
	}

	return headers;
}

export function buildAnthropicPayload(
	model: string,
	text: string,
	instruction: string,
): Record<string, unknown> {
	return {
		model,
		max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
		system: SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: buildUserPrompt(instruction, text) }],
			},
		],
	};
}

export function buildAnthropicHeaders(apiToken: string): Record<string, string> {
	return {
		"x-api-key": apiToken,
		"anthropic-version": ANTHROPIC_VERSION,
	};
}

export function buildGooglePayload(text: string, instruction: string): Record<string, unknown> {
	return {
		systemInstruction: {
			parts: [{ text: SYSTEM_PROMPT }],
		},
		contents: [
			{
				role: "user",
				parts: [{ text: buildUserPrompt(instruction, text) }],
			},
		],
	};
}

// The Google key travels in a header, never in the URL query string (it would land
// in proxy logs and URL-level telemetry there).
export function buildGoogleHeaders(apiToken: string): Record<string, string> {
	return { [GOOGLE_API_KEY_HEADER]: apiToken };
}

export function buildOllamaGeneratePayload(
	model: string,
	text: string,
	instruction: string,
): Record<string, unknown> {
	return {
		model,
		stream: false,
		// Ollama /api/generate has no separate system channel: SYSTEM_PROMPT is
		// prepended to the raw prompt exactly once.
		prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(instruction, text)}`,
	};
}

export function buildOpenAiLocalPayload(
	model: string,
	text: string,
	instruction: string,
): Record<string, unknown> {
	return buildOpenAiCompatiblePayload(model, text, instruction);
}
