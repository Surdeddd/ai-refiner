import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildUserPrompt } from "../src/providers/constants";
import {
	ANTHROPIC_MAX_OUTPUT_TOKENS,
	ANTHROPIC_VERSION,
	buildAnthropicHeaders,
	buildAnthropicPayload,
	buildGoogleHeaders,
	buildGooglePayload,
	buildOllamaGeneratePayload,
	buildOpenAiCompatibleHeaders,
	buildOpenAiCompatiblePayload,
	buildOpenAiLocalPayload,
} from "../src/providers/payloads";

const TEXT = "Original text.";
const INSTRUCTION = "  Make it shorter.  ";
const USER_PROMPT = buildUserPrompt(INSTRUCTION, TEXT);

describe("buildUserPrompt", () => {
	it("trims the instruction and never contains SYSTEM_PROMPT", () => {
		expect(USER_PROMPT).toBe(`Instruction:\nMake it shorter.\n\nText:\n${TEXT}`);
		expect(USER_PROMPT).not.toContain(SYSTEM_PROMPT);
	});
});

describe("buildOpenAiCompatiblePayload", () => {
	it("sends SYSTEM_PROMPT exactly once, in the system message only", () => {
		const payload = buildOpenAiCompatiblePayload("gpt-4o-mini", TEXT, INSTRUCTION);
		const messages = payload.messages as Array<{ role: string; content: string }>;

		expect(payload.model).toBe("gpt-4o-mini");
		expect(messages).toEqual([
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: USER_PROMPT },
		]);
		expect(messages[1]?.content).not.toContain(SYSTEM_PROMPT);
	});

	it("is shared by the OpenAI-compatible local path (no prompt duplication)", () => {
		expect(buildOpenAiLocalPayload("llama3.2", TEXT, INSTRUCTION))
			.toEqual(buildOpenAiCompatiblePayload("llama3.2", TEXT, INSTRUCTION));
	});
});

describe("buildOpenAiCompatibleHeaders", () => {
	it("sends a bearer token when present and none when empty", () => {
		expect(buildOpenAiCompatibleHeaders("tok", { isOpenRouter: false }))
			.toEqual({ Authorization: "Bearer tok" });
		expect(buildOpenAiCompatibleHeaders("", { isOpenRouter: false })).toEqual({});
	});

	it("adds OpenRouter attribution headers only for OpenRouter", () => {
		const headers = buildOpenAiCompatibleHeaders("tok", { isOpenRouter: true });
		expect(headers["HTTP-Referer"]).toBe("https://obsidian.md");
		expect(headers["X-Title"]).toBe("AI Refiner");
	});
});

describe("buildAnthropicPayload", () => {
	it("uses the system field and a typed user content block", () => {
		const payload = buildAnthropicPayload("claude-sonnet-5", TEXT, INSTRUCTION);

		expect(payload.system).toBe(SYSTEM_PROMPT);
		expect(payload.max_tokens).toBe(ANTHROPIC_MAX_OUTPUT_TOKENS);
		expect(payload.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: USER_PROMPT }] },
		]);
	});

	it("sends the token via x-api-key with the pinned API version", () => {
		expect(buildAnthropicHeaders("tok")).toEqual({
			"x-api-key": "tok",
			"anthropic-version": ANTHROPIC_VERSION,
		});
	});
});

describe("buildGooglePayload", () => {
	it("uses systemInstruction and a user content part", () => {
		const payload = buildGooglePayload(TEXT, INSTRUCTION);

		expect(payload.systemInstruction).toEqual({ parts: [{ text: SYSTEM_PROMPT }] });
		expect(payload.contents).toEqual([
			{ role: "user", parts: [{ text: USER_PROMPT }] },
		]);
	});

	it("sends the key via the x-goog-api-key header (never the URL)", () => {
		expect(buildGoogleHeaders("tok")).toEqual({ "x-goog-api-key": "tok" });
	});
});

describe("buildOllamaGeneratePayload", () => {
	it("embeds SYSTEM_PROMPT exactly once in the raw prompt (no system channel)", () => {
		const payload = buildOllamaGeneratePayload("llama3.2", TEXT, INSTRUCTION);
		const prompt = payload.prompt as string;

		expect(payload.model).toBe("llama3.2");
		expect(payload.stream).toBe(false);
		expect(prompt.split(SYSTEM_PROMPT).length - 1).toBe(1);
		expect(prompt).toContain(USER_PROMPT);
	});
});
