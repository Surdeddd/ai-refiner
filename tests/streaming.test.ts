import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderAbortError } from "../src/providers/IAIProvider";
import {
	NdjsonParser,
	SseParser,
	canStreamEndpoint,
	extractAnthropicStreamDelta,
	extractOllamaStreamDelta,
	extractOpenAiStreamDelta,
	isKnownCorsHost,
	resetStreamProbeCache,
	streamText,
	type FetchLike,
} from "../src/providers/streaming";

if (typeof globalThis.window === "undefined") {
	(globalThis as Record<string, unknown>).window = globalThis;
}

afterEach(() => {
	resetStreamProbeCache();
});

describe("SseParser", () => {
	it("emits data payloads and buffers events split across chunks", () => {
		const parser = new SseParser();
		expect(parser.push("data: {\"a\":1}\n\nda")).toEqual(['{"a":1}']);
		expect(parser.push("ta: {\"b\":2}\n")).toEqual([]);
		expect(parser.push("\n")).toEqual(['{"b":2}']);
	});

	it("joins multi-line data and handles CRLF", () => {
		const parser = new SseParser();
		expect(parser.push("event: x\r\ndata: one\r\ndata: two\r\n\r\n")).toEqual(["one\ntwo"]);
	});

	it("passes [DONE] through for the caller to filter", () => {
		const parser = new SseParser();
		expect(parser.push("data: [DONE]\n\n")).toEqual(["[DONE]"]);
	});
});

describe("NdjsonParser", () => {
	it("parses complete lines and buffers partial ones", () => {
		const parser = new NdjsonParser();
		expect(parser.push('{"response":"He"}\n{"resp')).toEqual([{ response: "He" }]);
		expect(parser.push('onse":"llo"}\n')).toEqual([{ response: "llo" }]);
	});

	it("skips garbled lines without dying", () => {
		const parser = new NdjsonParser();
		expect(parser.push("not-json\n{\"response\":\"ok\"}\n")).toEqual([{ response: "ok" }]);
	});
});

describe("delta extractors", () => {
	it("extracts OpenAI chat deltas", () => {
		expect(extractOpenAiStreamDelta({ choices: [{ delta: { content: "hi" } }] })).toBe("hi");
		expect(extractOpenAiStreamDelta({ choices: [{ delta: {} }] })).toBe("");
		expect(extractOpenAiStreamDelta(null)).toBe("");
	});

	it("extracts Anthropic content_block_delta text only", () => {
		expect(extractAnthropicStreamDelta({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })).toBe("hi");
		expect(extractAnthropicStreamDelta({ type: "message_start" })).toBe("");
	});

	it("extracts Ollama response deltas", () => {
		expect(extractOllamaStreamDelta({ response: "hi", done: false })).toBe("hi");
		expect(extractOllamaStreamDelta({ done: true })).toBe("");
	});
});

describe("canStreamEndpoint", () => {
	const fetchNever: FetchLike = () => {
		throw new Error("fetch must not be called");
	};

	it("streams known CORS-enabled API hosts without probing", async () => {
		expect(isKnownCorsHost("api.openai.com")).toBe(true);
		await expect(
			canStreamEndpoint(new URL("https://api.openai.com/v1/chat/completions"), {
				isPrivate: false,
				fetchImpl: fetchNever,
			}),
		).resolves.toBe(true);
	});

	it("refuses unknown public hosts without sending anything", async () => {
		await expect(
			canStreamEndpoint(new URL("https://llm.example.com/v1/chat/completions"), {
				isPrivate: false,
				fetchImpl: fetchNever,
			}),
		).resolves.toBe(false);
	});

	it("probes private hosts once and caches the verdict per origin", async () => {
		const probe = vi.fn(() => Promise.resolve(new Response("ok")));
		const url = new URL("http://127.0.0.1:11434/api/generate");

		await expect(canStreamEndpoint(url, { isPrivate: true, fetchImpl: probe })).resolves.toBe(true);
		await expect(canStreamEndpoint(url, { isPrivate: true, fetchImpl: probe })).resolves.toBe(true);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(probe.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/");
	});

	it("reports non-CORS private hosts as non-streamable (buffered requestUrl path)", async () => {
		const probe = vi.fn(() => Promise.reject(new TypeError("CORS")));
		await expect(
			canStreamEndpoint(new URL("http://127.0.0.1:9999/x"), { isPrivate: true, fetchImpl: probe }),
		).resolves.toBe(false);
	});
});

function streamResponse(chunks: string[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return new Response(body, { status: 200 });
}

describe("streamText", () => {
	it("accumulates deltas and reports them via onChunk", async () => {
		const parser = new SseParser();
		const chunks: string[] = [];
		const text = await streamText({
			url: "https://api.openai.com/v1/chat/completions",
			headers: {},
			body: "{}",
			onChunk: (delta) => chunks.push(delta),
			parseChunk: (chunk) =>
				parser.push(chunk)
					.filter((event) => event !== "[DONE]")
					.map((event) => extractOpenAiStreamDelta(JSON.parse(event))),
			fetchImpl: () => Promise.resolve(streamResponse([
				'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
			])),
		});

		expect(text).toBe("Hello");
		expect(chunks).toEqual(["Hel", "lo"]);
	});

	it("throws a readable error for HTTP failures", async () => {
		await expect(streamText({
			url: "https://api.openai.com/v1/chat/completions",
			headers: {},
			body: "{}",
			onChunk: () => undefined,
			parseChunk: () => [],
			fetchImpl: () => Promise.resolve(new Response("quota exceeded", { status: 429 })),
		})).rejects.toThrow(/429.*quota exceeded/s);
	});

	it("maps fetch aborts to ProviderAbortError", async () => {
		const controller = new AbortController();
		const pending = streamText({
			url: "https://api.openai.com/v1/chat/completions",
			headers: {},
			body: "{}",
			signal: controller.signal,
			onChunk: () => undefined,
			parseChunk: () => [],
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				}),
		});

		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);
	});

	it("short-circuits on a pre-aborted signal without fetching", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchSpy = vi.fn();

		await expect(streamText({
			url: "https://api.openai.com/v1",
			headers: {},
			body: "{}",
			signal: controller.signal,
			onChunk: () => undefined,
			parseChunk: () => [],
			fetchImpl: fetchSpy as never,
		})).rejects.toBeInstanceOf(ProviderAbortError);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
