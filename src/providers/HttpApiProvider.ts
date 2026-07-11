import { requestUrl } from "obsidian";
import type { HttpApiConfig } from "../settings/types";
import {
    extractNamedValues,
    extractTextContent,
    inferOpenAiModelsUrl,
    isPrivateHost,
    isRecord,
    parseJson,
    removeTrailingSlash,
    requestUrlWithSignal,
    unique,
} from "../utils/api";
import type { IAIProvider, ProviderGenerateOptions } from "./IAIProvider";
import { throwIfAborted } from "./IAIProvider";
import {
	GOOGLE_API_KEY_HEADER,
	buildAnthropicHeaders,
	buildAnthropicPayload,
	buildGoogleHeaders,
	buildGooglePayload,
	buildOpenAiCompatibleHeaders,
	buildOpenAiCompatiblePayload,
} from "./payloads";

type EndpointKind = "openai-compatible" | "anthropic" | "google";

export class HttpApiProvider implements IAIProvider {
	private readonly config: HttpApiConfig;

	constructor(config: HttpApiConfig) {
		this.config = config;
	}

	async generate(text: string, instruction: string, options?: ProviderGenerateOptions): Promise<string> {
		throwIfAborted(options?.signal);
		const endpointUrl = parseEndpoint(this.config.endpoint);
		const model = this.config.model.trim();
		const apiToken = this.config.apiToken.trim();
		const endpointKind = detectEndpointKind(endpointUrl);
		if (!model) {
			throw new Error(`${getProviderLabel()} model is required.`);
		}
		if (requiresToken(endpointUrl) && !apiToken) {
			throw new Error(`${getProviderLabel()} token is required.`);
		}

		switch (endpointKind) {
			case "anthropic":
				return this.generateAnthropic(endpointUrl, model, apiToken, text, instruction, options?.signal);
			case "google":
				return this.generateGoogle(endpointUrl, model, apiToken, text, instruction, options?.signal);
			case "openai-compatible":
				return this.generateOpenAiCompatible(endpointUrl, model, apiToken, text, instruction, options?.signal);
			default:
				return assertNever(endpointKind);
		}
	}

	private async generateOpenAiCompatible(
		endpointUrl: URL,
		model: string,
		apiToken: string,
		text: string,
		instruction: string,
		signal?: AbortSignal,
	): Promise<string> {
		const response = await requestUrlWithSignal({
			url: endpointUrl.toString(),
			method: "POST",
			contentType: "application/json",
			headers: buildOpenAiCompatibleHeaders(apiToken, { isOpenRouter: isOpenRouterEndpoint(endpointUrl) }),
			body: JSON.stringify(buildOpenAiCompatiblePayload(model, text, instruction)),
			throw: false,
		}, signal);

		const payload = parseJson(response.text);
		if (response.status >= 400) {
			throw buildRequestError(getProviderLabel(), response.status, payload, response.text);
		}

		const content = extractOpenAiCompatibleContent(payload);
		if (!content) {
			throw new Error(`${getProviderLabel()} returned empty response content.`);
		}

		return content;
	}

	private async generateAnthropic(
		endpointUrl: URL,
		model: string,
		apiToken: string,
		text: string,
		instruction: string,
		signal?: AbortSignal,
	): Promise<string> {
		const response = await requestUrlWithSignal({
			url: endpointUrl.toString(),
			method: "POST",
			contentType: "application/json",
			headers: buildAnthropicHeaders(apiToken),
			body: JSON.stringify(buildAnthropicPayload(model, text, instruction)),
			throw: false,
		}, signal);

		const payload = parseJson(response.text);
		if (response.status >= 400) {
			throw buildRequestError(getProviderLabel(), response.status, payload, response.text);
		}

		const content = extractAnthropicContent(payload);
		if (!content) {
			throw new Error("Anthropic API returned empty response content.");
		}

		return content;
	}

	private async generateGoogle(
		endpointUrl: URL,
		model: string,
		apiToken: string,
		text: string,
		instruction: string,
		signal?: AbortSignal,
	): Promise<string> {
		const url = buildGoogleGenerateContentUrl(endpointUrl, model);
		const response = await requestUrlWithSignal({
			url: url.toString(),
			method: "POST",
			contentType: "application/json",
			headers: buildGoogleHeaders(apiToken),
			body: JSON.stringify(buildGooglePayload(text, instruction)),
			throw: false,
		}, signal);

		const payload = parseJson(response.text);
		if (response.status >= 400) {
			throw buildRequestError(getProviderLabel(), response.status, payload, response.text);
		}

		const content = extractGoogleContent(payload);
		if (!content) {
			throw new Error("Google Gemini API returned empty response content.");
		}

		return content;
	}

}

export async function discoverModelsForProvider(config: HttpApiConfig): Promise<string[]> {
	const endpointUrl = parseEndpoint(config.endpoint);
	const apiToken = config.apiToken.trim();
	const endpointKind = detectEndpointKind(endpointUrl);
	if (requiresToken(endpointUrl) && !apiToken) {
		throw new Error(`${getProviderLabel()} token is required.`);
	}

	switch (endpointKind) {
		case "anthropic":
			return discoverAnthropicModels(endpointUrl, apiToken);
		case "google":
			return discoverGoogleModels(endpointUrl, apiToken);
		case "openai-compatible":
			return discoverOpenAiCompatibleModels(endpointUrl, apiToken);
		default:
			return assertNever(endpointKind);
	}
}

function parseEndpoint(rawEndpoint: string): URL {
	const endpoint = rawEndpoint.trim();
	if (!endpoint) {
		throw new Error("API endpoint is required.");
	}

	try {
		return new URL(endpoint);
	} catch {
		throw new Error("API endpoint must be a valid URL.");
	}
}

async function discoverOpenAiCompatibleModels(
	endpointUrl: URL,
	apiToken: string,
): Promise<string[]> {
	const modelsUrl = inferOpenAiModelsUrl(endpointUrl);
	const headers: Record<string, string> = {};
	if (apiToken) {
		headers["Authorization"] = `Bearer ${apiToken}`;
	}

	const response = await requestUrl({
		url: modelsUrl.toString(),
		method: "GET",
		headers,
		throw: false,
	});

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw buildRequestError("API provider", response.status, payload, response.text);
	}

	return unique([
		...extractNamedValues(payload, "data", "id"),
		...extractNamedValues(payload, "models", "id"),
		...extractNamedValues(payload, "models", "name"),
	]);
}

async function discoverAnthropicModels(endpointUrl: URL, apiToken: string): Promise<string[]> {
	const modelsUrl = inferAnthropicModelsUrl(endpointUrl);
	const response = await requestUrl({
		url: modelsUrl.toString(),
		method: "GET",
		headers: buildAnthropicHeaders(apiToken),
		throw: false,
	});

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw buildRequestError("Anthropic API", response.status, payload, response.text);
	}

	return unique([
		...extractNamedValues(payload, "data", "id"),
		...extractNamedValues(payload, "models", "id"),
		...extractNamedValues(payload, "models", "name"),
	]);
}

async function discoverGoogleModels(endpointUrl: URL, apiToken: string): Promise<string[]> {
	const modelsUrl = inferGoogleModelsUrl(endpointUrl);
	const response = await requestUrl({
		url: modelsUrl.toString(),
		method: "GET",
		headers: { [GOOGLE_API_KEY_HEADER]: apiToken },
		throw: false,
	});

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw buildRequestError("Google Gemini API", response.status, payload, response.text);
	}

	const names = extractNamedValues(payload, "models", "name")
		.map((value) => value.startsWith("models/") ? value.slice("models/".length) : value);
	return unique(names);
}

function inferAnthropicModelsUrl(endpointUrl: URL): URL {
	const next = new URL(endpointUrl.toString());
	const pathname = removeTrailingSlash(next.pathname);
	if (pathname.endsWith("/models")) {
		return next;
	}

	if (pathname.endsWith("/messages")) {
		next.pathname = `${pathname.slice(0, -"/messages".length)}/models`;
		return next;
	}

	next.pathname = `${pathname}/models`;
	return next;
}

function inferGoogleModelsUrl(endpointUrl: URL): URL {
	const next = new URL(endpointUrl.toString());
	next.pathname = normalizeGoogleModelsPath(next.pathname);
	// The API key travels in the x-goog-api-key header, not the query string,
	// so it never lands in proxy logs or URL-level telemetry.
	next.searchParams.delete("key");
	return next;
}

function buildGoogleGenerateContentUrl(endpointUrl: URL, model: string): URL {
	const next = new URL(endpointUrl.toString());
	const encodedModel = encodeURIComponent(model);
	next.pathname = normalizeGoogleGeneratePath(next.pathname, encodedModel);
	next.searchParams.delete("key");
	return next;
}

function normalizeGoogleModelsPath(pathname: string): string {
	const normalized = removeTrailingSlash(pathname);
	if (normalized.includes(":generateContent")) {
		const beforeAction = normalized.slice(0, normalized.indexOf(":generateContent"));
		const modelSegmentIndex = beforeAction.indexOf("/models/");
		if (modelSegmentIndex >= 0) {
			return `${beforeAction.slice(0, modelSegmentIndex)}/models`;
		}
		return `${beforeAction}/models`;
	}

	const modelSegmentIndex = normalized.indexOf("/models/");
	if (modelSegmentIndex >= 0) {
		return `${normalized.slice(0, modelSegmentIndex)}/models`;
	}

	if (normalized.endsWith("/models")) {
		return normalized;
	}

	return `${normalized}/models`;
}

function normalizeGoogleGeneratePath(pathname: string, encodedModel: string): string {
	const normalized = removeTrailingSlash(pathname);
	const modelBase = `/models/${encodedModel}`;
	const actionSuffix = ":generateContent";
	if (normalized.includes(":generateContent")) {
		const withoutAction = normalized.slice(0, normalized.indexOf(":generateContent"));
		const modelSegmentIndex = withoutAction.indexOf("/models/");
		if (modelSegmentIndex >= 0) {
			return `${withoutAction.slice(0, modelSegmentIndex)}${modelBase}${actionSuffix}`;
		}
		return `${withoutAction}${modelBase}${actionSuffix}`;
	}

	const modelSegmentIndex = normalized.indexOf("/models/");
	if (modelSegmentIndex >= 0) {
		return `${normalized.slice(0, modelSegmentIndex)}${modelBase}${actionSuffix}`;
	}

	if (normalized.endsWith("/models")) {
		return `${normalized}/${encodedModel}${actionSuffix}`;
	}

	return `${normalized}${modelBase}${actionSuffix}`;
}

function extractOpenAiCompatibleContent(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const choices = payload["choices"];
	if (!Array.isArray(choices) || choices.length === 0) {
		return null;
	}

	const choiceList = choices as unknown[];
	const firstChoice = choiceList[0];
	if (!isRecord(firstChoice)) {
		return null;
	}

	const message = firstChoice["message"];
	if (isRecord(message)) {
		const content = extractTextContent(message["content"]);
		if (content) {
			return content;
		}
	}

	const text = extractTextContent(firstChoice["text"]);
	return text;
}

function extractAnthropicContent(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const content = payload["content"];
	if (!Array.isArray(content)) {
		return null;
	}

	const parts = content
		.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
		.join("")
		.trim();
	return parts.length > 0 ? parts : null;
}

function extractGoogleContent(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const candidates = payload["candidates"];
	if (!Array.isArray(candidates) || candidates.length === 0) {
		return null;
	}

	const candidateList = candidates as unknown[];
	const first = candidateList[0];
	if (!isRecord(first)) {
		return null;
	}

	const content = first["content"];
	if (!isRecord(content)) {
		return null;
	}

	const parts = content["parts"];
	if (!Array.isArray(parts)) {
		return null;
	}

	const text = parts
		.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
		.join("")
		.trim();
	return text.length > 0 ? text : null;
}

function buildRequestError(providerLabel: string, status: number, payload: unknown, rawBody: string): Error {
	const details = extractErrorMessage(payload) ?? rawBody.trim() ?? `Status ${status}`;
	return new Error(`${providerLabel} request failed (${status}): ${details}`);
}

function extractErrorMessage(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const rootMessage = payload["message"];
	if (typeof rootMessage === "string" && rootMessage.trim().length > 0) {
		return rootMessage.trim();
	}

	const errorPayload = payload["error"];
	if (typeof errorPayload === "string" && errorPayload.trim().length > 0) {
		return errorPayload.trim();
	}
	if (!isRecord(errorPayload)) {
		return null;
	}

	const errorMessage = errorPayload["message"];
	if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
		return errorMessage.trim();
	}

	const errorCode = errorPayload["code"];
	if (typeof errorCode === "string" && errorCode.trim().length > 0) {
		return errorCode.trim();
	}

	return null;
}

function requiresToken(endpointUrl: URL): boolean {
	return !isPrivateHost(endpointUrl.hostname);
}

function getProviderLabel(): string {
	return "API provider";
}

function detectEndpointKind(endpointUrl: URL): EndpointKind {
	const host = endpointUrl.hostname.toLowerCase();
	const path = endpointUrl.pathname.toLowerCase();
	const combined = `${host}${path}`;

	if (combined.includes("anthropic")) {
		return "anthropic";
	}
	if (combined.includes("googleapis.com") || combined.includes("generativelanguage")) {
		return "google";
	}
	return "openai-compatible";
}

function isOpenRouterEndpoint(endpointUrl: URL): boolean {
	const host = endpointUrl.hostname.toLowerCase();
	return host.includes("openrouter.ai");
}

function assertNever(value: never): never {
	void value;
	throw new Error("Unsupported API provider.");
}
