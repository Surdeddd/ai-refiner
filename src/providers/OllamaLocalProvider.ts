import { requestUrl } from "obsidian";
import type { OllamaLocalConfig } from "../settings/types";
import {
    extractNamedValues,
    extractTextContent,
    inferOpenAiModelsUrl,
    isRecord,
    parseJson,
    requestUrlWithAbort,
    unique,
} from "../utils/api";
import type { IAIProvider, ProviderGenerateOptions } from "./IAIProvider";
import { ProviderAbortError, throwIfAborted } from "./IAIProvider";
import { SYSTEM_PROMPT } from "./constants";

interface OllamaGenerateResponse {
	response?: string;
	error?: string;
}

type LocalEndpointKind = "ollama" | "openai-compatible";

export class OllamaLocalProvider implements IAIProvider {
	constructor(private readonly config: OllamaLocalConfig) {}

	async generate(text: string, instruction: string, options?: ProviderGenerateOptions): Promise<string> {
		throwIfAborted(options?.signal);
		const endpoint = parseEndpoint(this.config.endpoint);
		const model = this.config.model.trim();
		if (!model) {
			throw new Error("Local model id is required.");
		}

		const prompt = buildPrompt(text, instruction);
		const primaryKind = detectLocalEndpointKind(endpoint);
		const attempts: Array<{
			label: string;
			run: () => Promise<string>;
		}> = primaryKind === "ollama"
			? [
				{ label: "Ollama", run: () => generateWithOllama(endpoint, model, prompt, options?.signal) },
				{ label: "OpenAI-compatible local", run: () => generateWithOpenAiLocal(endpoint, model, prompt, options?.signal) },
			]
			: [
				{ label: "OpenAI-compatible local", run: () => generateWithOpenAiLocal(endpoint, model, prompt, options?.signal) },
				{ label: "Ollama", run: () => generateWithOllama(endpoint, model, prompt, options?.signal) },
			];

		const errors: string[] = [];
		for (const attempt of attempts) {
			try {
				return await attempt.run();
			} catch (error: unknown) {
				// Cancellation must abort the whole flow, not fall through to the
				// other backend (which would re-reject and mask the abort).
				if (error instanceof ProviderAbortError || options?.signal?.aborted) {
					throw error instanceof ProviderAbortError ? error : new ProviderAbortError();
				}
				errors.push(`${attempt.label}: ${getErrorMessage(error)}`);
			}
		}

		throw new Error(`Local model request failed. ${errors.join(" | ")}`);
	}
}

export async function discoverOllamaModels(config: OllamaLocalConfig): Promise<string[]> {
	const endpoint = parseEndpoint(config.endpoint);
	const primaryKind = detectLocalEndpointKind(endpoint);
	const attempts: Array<{
		label: string;
		run: () => Promise<string[]>;
	}> = primaryKind === "ollama"
		? [
			{ label: "Ollama", run: () => discoverViaOllama(endpoint) },
			{ label: "OpenAI-compatible local", run: () => discoverViaOpenAi(endpoint) },
		]
		: [
			{ label: "OpenAI-compatible local", run: () => discoverViaOpenAi(endpoint) },
			{ label: "Ollama", run: () => discoverViaOllama(endpoint) },
		];

	const errors: string[] = [];
	for (const attempt of attempts) {
		try {
			const models = await attempt.run();
			if (models.length > 0) {
				return models;
			}
		} catch (error: unknown) {
			errors.push(`${attempt.label}: ${getErrorMessage(error)}`);
		}
	}

	if (errors.length > 0) {
		throw new Error(`Local model discovery failed. ${errors.join(" | ")}`);
	}

	return [];
}

function buildPrompt(text: string, instruction: string): string {
	return `${SYSTEM_PROMPT}\n\nInstruction:\n${instruction.trim()}\n\nText:\n${text}`;
}

function parseEndpoint(rawEndpoint: string): URL {
	const endpoint = rawEndpoint.trim();
	if (!endpoint) {
		throw new Error("Local model server endpoint is required.");
	}

	try {
		return new URL(endpoint);
	} catch {
		throw new Error("Local model server endpoint must be a valid URL.");
	}
}

function buildOllamaGenerateUrl(endpoint: URL): URL {
	const next = new URL(endpoint.toString());
	next.pathname = normalizePath(next.pathname, "/api/generate");
	return next;
}

function buildOllamaTagsUrl(endpoint: URL): URL {
	const next = new URL(endpoint.toString());
	next.pathname = normalizePath(next.pathname, "/api/tags");
	return next;
}

function normalizePath(pathname: string, suffix: string): string {
	const normalized = pathname.replace(/\/+$/g, "");
	if (normalized.endsWith(suffix)) {
		return normalized;
	}
	return `${normalized}${suffix}`;
}

function extractOllamaOutput(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const typedPayload = payload as OllamaGenerateResponse;
	if (typeof typedPayload.response === "string") {
		const trimmed = typedPayload.response.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	return null;
}

function extractError(payload: unknown, rawBody: string): string {
	if (isRecord(payload)) {
		const typedPayload = payload as OllamaGenerateResponse;
		if (typeof typedPayload.error === "string" && typedPayload.error.trim().length > 0) {
			return typedPayload.error.trim();
		}
	}

	const fallback = rawBody.trim();
	return fallback.length > 0 ? fallback : "Unknown error";
}

function extractOllamaModelNames(payload: unknown): string[] {
	if (!isRecord(payload)) {
		return [];
	}

	const modelsValue = payload["models"];
	if (!Array.isArray(modelsValue)) {
		return [];
	}

	return modelsValue
		.map((model) => {
			if (!isRecord(model)) {
				return "";
			}
			const name = model["name"];
			return typeof name === "string" ? name : "";
		})
		.filter((name) => name.trim().length > 0);
}

function extractOpenAiModelNames(payload: unknown): string[] {
	if (!isRecord(payload)) {
		return [];
	}

	return unique([
		...extractNamedValues(payload, "data", "id"),
		...extractNamedValues(payload, "models", "id"),
		...extractNamedValues(payload, "models", "name"),
	]);
}

function extractOpenAiContent(payload: unknown): string | null {
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

	return extractTextContent(firstChoice["text"]);
}

async function generateWithOllama(
	endpoint: URL,
	model: string,
	prompt: string,
	signal?: AbortSignal,
): Promise<string> {
	const response = await requestUrlWithAbort({
		url: buildOllamaGenerateUrl(endpoint).toString(),
		method: "POST",
		contentType: "application/json",
		body: JSON.stringify({
			model,
			stream: false,
			prompt,
		}),
		throw: false,
	}, signal);

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw new Error(`Ollama request failed (${response.status}): ${extractError(payload, response.text)}`);
	}

	const output = extractOllamaOutput(payload);
	if (!output) {
		throw new Error("Ollama returned empty output.");
	}

	return output;
}

async function generateWithOpenAiLocal(
	endpoint: URL,
	model: string,
	prompt: string,
	signal?: AbortSignal,
): Promise<string> {
	const response = await requestUrlWithAbort({
		url: endpoint.toString(),
		method: "POST",
		contentType: "application/json",
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: prompt },
			],
		}),
		throw: false,
	}, signal);

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw new Error(
			`OpenAI-compatible local request failed (${response.status}): ${extractError(payload, response.text)}`,
		);
	}

	const output = extractOpenAiContent(payload);
	if (!output) {
		throw new Error("OpenAI-compatible local server returned empty output.");
	}

	return output;
}

async function discoverViaOllama(endpoint: URL): Promise<string[]> {
	const response = await requestUrl({
		url: buildOllamaTagsUrl(endpoint).toString(),
		method: "GET",
		throw: false,
	});

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw new Error(`Ollama models request failed (${response.status}): ${extractError(payload, response.text)}`);
	}

	return unique(extractOllamaModelNames(payload));
}

async function discoverViaOpenAi(endpoint: URL): Promise<string[]> {
	const modelsUrl = inferOpenAiModelsUrl(endpoint);
	const response = await requestUrl({
		url: modelsUrl.toString(),
		method: "GET",
		throw: false,
	});

	const payload = parseJson(response.text);
	if (response.status >= 400) {
		throw new Error(
			`OpenAI-compatible local models request failed (${response.status}): ${extractError(payload, response.text)}`,
		);
	}

	return extractOpenAiModelNames(payload);
}

function detectLocalEndpointKind(endpoint: URL): LocalEndpointKind {
	if (isLikelyOllamaEndpoint(endpoint)) {
		return "ollama";
	}
	return "openai-compatible";
}

function isLikelyOllamaEndpoint(endpoint: URL): boolean {
	const host = endpoint.hostname.toLowerCase();
	const path = endpoint.pathname.toLowerCase();
	return host.includes("ollama")
		|| endpoint.port === "11434"
		|| path.includes("/api/generate")
		|| path.includes("/api/tags");
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "Unknown error";
}
