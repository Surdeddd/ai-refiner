import { ProviderAbortError } from "./IAIProvider";

// Streaming transport for HTTP providers. Obsidian's requestUrl cannot stream, so
// streaming uses native fetch — which is subject to CORS. To NEVER risk a duplicate
// generation POST, the stream-vs-buffered decision is made BEFORE the single request
// is sent: well-known CORS-enabled API hosts stream directly, private/local hosts
// are probed once with an idempotent GET, everything else stays on requestUrl.
// If a chosen stream fails mid-flight the error propagates — there is no re-POST.

const KNOWN_CORS_HOSTS = [
	"api.openai.com",
	"api.anthropic.com",
	"openrouter.ai",
	"api.groq.com",
	"api.mistral.ai",
	"api.deepseek.com",
	"api.x.ai",
];

const PROBE_TIMEOUT_MS = 1_500;

// Session-scoped probe results per origin; a probe is one GET, so caching avoids
// re-probing on every request while Obsidian is open.
const probeCache = new Map<string, boolean>();

export function isKnownCorsHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return KNOWN_CORS_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function getFetch(fetchImpl?: FetchLike): FetchLike | null {
	if (fetchImpl) {
		return fetchImpl;
	}
	// window.fetch on purpose (not requestUrl): requestUrl can neither stream nor
	// abort. The CORS gate above guarantees we only take this path when safe.
	return typeof window !== "undefined" && typeof window.fetch === "function"
		? (window.fetch.bind(window) as FetchLike)
		: null;
}

// Decides whether the endpoint can be streamed with native fetch. Known API hosts:
// yes. Private/local hosts: probe the origin once with a GET — if the server sends
// CORS headers the GET resolves (any status is fine), otherwise fetch throws and we
// stay on the buffered requestUrl path. Unknown public hosts: no (requestUrl is
// CORS-free and safe; guessing wrong would burn the generation request).
export async function canStreamEndpoint(
	endpointUrl: URL,
	options: { isPrivate: boolean; fetchImpl?: FetchLike },
): Promise<boolean> {
	const fetchFn = getFetch(options.fetchImpl);
	if (!fetchFn) {
		return false;
	}

	if (isKnownCorsHost(endpointUrl.hostname)) {
		return true;
	}
	if (!options.isPrivate) {
		return false;
	}

	const cached = probeCache.get(endpointUrl.origin);
	if (cached !== undefined) {
		return cached;
	}

	let result = false;
	try {
		const controller = new AbortController();
		const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
		try {
			await fetchFn(endpointUrl.origin + "/", { method: "GET", signal: controller.signal });
			result = true;
		} finally {
			window.clearTimeout(timer);
		}
	} catch {
		result = false;
	}
	probeCache.set(endpointUrl.origin, result);
	return result;
}

export function resetStreamProbeCache(): void {
	probeCache.clear();
}

// Incremental SSE parser. Feed it raw text chunks in arrival order; it emits the
// `data:` payload of every complete event and buffers partial events across chunks.
export class SseParser {
	private buffer = "";

	push(chunk: string): string[] {
		this.buffer += chunk.replace(/\r\n/g, "\n");
		const events: string[] = [];

		let separatorIndex = this.buffer.indexOf("\n\n");
		while (separatorIndex >= 0) {
			const rawEvent = this.buffer.slice(0, separatorIndex);
			this.buffer = this.buffer.slice(separatorIndex + 2);

			const dataLines = rawEvent
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).replace(/^ /, ""));
			if (dataLines.length > 0) {
				events.push(dataLines.join("\n"));
			}

			separatorIndex = this.buffer.indexOf("\n\n");
		}
		return events;
	}
}

// Incremental NDJSON parser (Ollama's stream format): one JSON object per line.
export class NdjsonParser {
	private buffer = "";

	push(chunk: string): unknown[] {
		this.buffer += chunk;
		const objects: unknown[] = [];

		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line) {
				try {
					objects.push(JSON.parse(line));
				} catch {
					// Incomplete/garbled line: skip — the stream's final accumulated
					// text is what actually matters.
				}
			}
			newlineIndex = this.buffer.indexOf("\n");
		}
		return objects;
	}
}

export function extractOpenAiStreamDelta(payload: unknown): string {
	if (typeof payload !== "object" || payload === null) {
		return "";
	}
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		return "";
	}
	const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
	return typeof delta?.content === "string" ? delta.content : "";
}

export function extractAnthropicStreamDelta(payload: unknown): string {
	if (typeof payload !== "object" || payload === null) {
		return "";
	}
	const event = payload as { type?: unknown; delta?: { type?: unknown; text?: unknown } };
	if (event.type !== "content_block_delta") {
		return "";
	}
	return typeof event.delta?.text === "string" ? event.delta.text : "";
}

export function extractOllamaStreamDelta(payload: unknown): string {
	if (typeof payload !== "object" || payload === null) {
		return "";
	}
	const response = (payload as { response?: unknown }).response;
	return typeof response === "string" ? response : "";
}

export interface StreamRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
	signal?: AbortSignal;
	onChunk: (delta: string) => void;
	// Turns one raw network chunk into zero or more text deltas.
	parseChunk: (chunk: string) => string[];
	fetchImpl?: FetchLike;
}

// Sends the POST with native fetch and streams the response body. Returns the full
// accumulated text. AbortSignal here is a REAL transport abort (unlike requestUrl).
export async function streamText(request: StreamRequest): Promise<string> {
	const fetchFn = getFetch(request.fetchImpl);
	if (!fetchFn) {
		throw new Error("Streaming is unavailable: fetch is missing.");
	}
	if (request.signal?.aborted) {
		throw new ProviderAbortError();
	}

	let response: Response;
	try {
		response = await fetchFn(request.url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...request.headers },
			body: request.body,
			signal: request.signal,
		});
	} catch (error: unknown) {
		if (isFetchAbort(error, request.signal)) {
			throw new ProviderAbortError();
		}
		throw error;
	}

	if (!response.ok) {
		const bodyText = await response.text().catch(() => "");
		throw new Error(`Request failed (${response.status}): ${bodyText.slice(0, 300) || response.statusText}`);
	}
	if (!response.body) {
		throw new Error("Streaming is unavailable: response has no body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let fullText = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const deltas = request.parseChunk(decoder.decode(value, { stream: true }));
			for (const delta of deltas) {
				if (delta) {
					fullText += delta;
					request.onChunk(delta);
				}
			}
		}
	} catch (error: unknown) {
		if (isFetchAbort(error, request.signal)) {
			throw new ProviderAbortError();
		}
		throw error;
	}

	return fullText;
}

function isFetchAbort(error: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) {
		return true;
	}
	return error instanceof DOMException && error.name === "AbortError";
}
