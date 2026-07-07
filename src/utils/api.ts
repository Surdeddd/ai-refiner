import { requestUrl } from "obsidian";
import { ProviderAbortError } from "../providers/IAIProvider";

export async function requestUrlWithAbort(
	params: Parameters<typeof requestUrl>[0],
	signal?: AbortSignal,
) {
	if (signal?.aborted) {
		throw new ProviderAbortError();
	}

	const requestPromise = requestUrl(params);
	if (!signal) {
		return requestPromise;
	}

	return await raceWithAbort(requestPromise, signal);
}

export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(new ProviderAbortError());
	}

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(new ProviderAbortError());
		};

		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(normalizeError(error));
			},
		);
	});
}

export function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error("Request failed.");
}

export function parseJson(raw: string): unknown {
	if (!raw.trim()) {
		return null;
	}

	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function extractTextContent(content: unknown): string | null {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	if (Array.isArray(content)) {
		const text = content
			.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
			.join("")
			.trim();
		return text.length > 0 ? text : null;
	}

	if (isRecord(content) && typeof content["text"] === "string") {
		const trimmed = content["text"].trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	return null;
}

export function extractNamedValues(payload: unknown, containerKey: string, valueKey: string): string[] {
	if (!isRecord(payload)) {
		return [];
	}

	const container = payload[containerKey];
	if (!Array.isArray(container)) {
		return [];
	}

	return container
		.map((item) => (isRecord(item) && typeof item[valueKey] === "string" ? item[valueKey] : ""))
		.filter((value) => value.trim().length > 0);
}

export function unique(items: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

export function removeTrailingSlash(pathname: string): string {
	const normalized = pathname.replace(/\/+$/g, "");
	return normalized.length > 0 ? normalized : "/";
}

// Derives an OpenAI-style `/models` list endpoint from a chat/completions-style
// endpoint URL, tolerating the common path shapes across compatible servers.
export function inferOpenAiModelsUrl(endpointUrl: URL): URL {
	const next = new URL(endpointUrl.toString());
	const pathname = removeTrailingSlash(next.pathname);
	if (pathname.endsWith("/models")) {
		next.pathname = pathname;
		return next;
	}

	const replacements = ["/chat/completions", "/responses", "/completions", "/messages"];
	for (const suffix of replacements) {
		if (pathname.endsWith(suffix)) {
			next.pathname = `${pathname.slice(0, -suffix.length)}/models`;
			return next;
		}
	}

	const modelSegmentIndex = pathname.indexOf("/models/");
	if (modelSegmentIndex >= 0) {
		next.pathname = `${pathname.slice(0, modelSegmentIndex)}/models`;
		return next;
	}

	next.pathname = `${pathname}/models`;
	return next;
}

const PRIVATE_HOST_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa"];
const PRIVATE_IPV4_PATTERNS = [
	/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^192\.168\.\d{1,3}\.\d{1,3}$/,
	/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
];

export function normalizeHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}
	return normalized;
}

// UX heuristic only (drives "token optional" hints for local endpoints). This is
// NOT an SSRF boundary: it misses decimal/octal/hex IPv4, IPv4-mapped IPv6, and
// DNS names that resolve to private space. Never promote it to a request gate.
export function isPrivateHost(hostname: string): boolean {
	const host = normalizeHostname(hostname);
	if (host === "localhost" || host === "::1") {
		return true;
	}
	if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return true;
	}
	if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))) {
		return true;
	}
	if (host.includes(":")) {
		return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
	}
	return false;
}
