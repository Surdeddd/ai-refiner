import { type RequestUrlResponse } from "obsidian";
import { isRecord, requestUrlWithSignal } from "../utils/api";
import { ProviderAbortError, throwIfAborted } from "../providers/IAIProvider";
import {
	VOICE_LOOPBACK_HOST_CANDIDATES,
	VOICE_WAV_MIME_TYPE,
} from "./constants";

const LOOPBACK_HOST_SET = new Set<string>([
	...VOICE_LOOPBACK_HOST_CANDIDATES.map(normalizeHost),
	"::1",
]);

export interface SttApiConfig {
	endpoint: string;
	model: string;
	apiToken: string;
	languageCode: string;
}

export async function transcribeAudioViaApi(
	audio: Blob,
	config: SttApiConfig,
	signal?: AbortSignal,
): Promise<string> {
	throwIfAborted(signal);
	const endpoint = config.endpoint.trim();
	const model = config.model.trim();
	const token = config.apiToken.trim();
	if (!endpoint) {
		throw new Error("Voice API endpoint is required.");
	}
	if (!model) {
		throw new Error("Voice API model is required.");
	}

	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error("Voice API endpoint is invalid.");
	}

	const { body, contentType } = await buildMultipartBody(model, audio, config.languageCode);

	const headers: Record<string, string> = {
		"Content-Type": contentType,
	};
	if (token.length > 0) {
		headers.Authorization = `Bearer ${token}`;
	}

	const candidates = createEndpointCandidates(url);
	let lastNetworkError: Error | null = null;

	for (const candidate of candidates) {
		let response: RequestUrlResponse;
		try {
			response = await requestUrlWithSignal({
				url: candidate.toString(),
				method: "POST",
				headers,
				body,
				throw: false,
			}, signal);
		} catch (error: unknown) {
			// A user-cancelled transcription must not be retried against other
			// loopback candidates or reported as a network failure.
			if (error instanceof ProviderAbortError || signal?.aborted) {
				throw error instanceof ProviderAbortError ? error : new ProviderAbortError();
			}
			lastNetworkError = new Error(`Voice API request failed: ${toErrorMessage(error)}`);
			continue;
		}

		const payload = readPayload(response);
		if (response.status >= 400) {
			throw new Error(
				`Voice API request failed (${response.status}): ${extractApiError(payload, response.text)}`,
			);
		}

		const text = extractTranscript(payload);
		if (!text) {
			const details = extractApiError(payload, "");
			if (details && details !== "Unknown error") {
				throw new Error(`Voice API request failed: ${details}`);
			}
			throw new Error("Voice API returned empty transcription.");
		}

		return text;
	}

	if (lastNetworkError) {
		throw lastNetworkError;
	}
	throw new Error("Voice API request failed.");
}

async function buildMultipartBody(
	model: string,
	audio: Blob,
	languageCode: string,
): Promise<{ body: ArrayBuffer; contentType: string }> {
	const boundary = `----ai-refiner-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];

	chunks.push(
		encoder.encode(
			`--${boundary}\r\n`
			+ `Content-Disposition: form-data; name="model"\r\n\r\n`
			+ `${model}\r\n`,
		),
	);

	const language = toSttLanguage(languageCode);
	if (language) {
		chunks.push(
			encoder.encode(
				`--${boundary}\r\n`
				+ `Content-Disposition: form-data; name="language"\r\n\r\n`
				+ `${language}\r\n`,
			),
		);
	}

	const filename = getAudioFilename(audio.type);
	const mimeType = audio.type.trim() || "application/octet-stream";
	chunks.push(
		encoder.encode(
			`--${boundary}\r\n`
			+ `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
			+ `Content-Type: ${mimeType}\r\n\r\n`,
		),
	);
	chunks.push(new Uint8Array(await audio.arrayBuffer()));
	chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	const merged = concatBytes(chunks);
	return {
		body: toExactArrayBuffer(merged),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

function getAudioFilename(mimeType: string): string {
	if (mimeType.includes("ogg")) {
		return "voice-input.ogg";
	}
	if (mimeType.includes("mp4") || mimeType.includes("mpeg")) {
		return "voice-input.mp4";
	}
	if (mimeType.includes("wav") || mimeType === VOICE_WAV_MIME_TYPE) {
		return "voice-input.wav";
	}
	return "voice-input.webm";
}

function toSttLanguage(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return "";
	}

	if (normalized.includes("-")) {
		const [language] = normalized.split("-", 1);
		return language ?? "";
	}
	return normalized;
}

function readPayload(response: RequestUrlResponse): unknown {
	const contentType = getHeader(response.headers, "content-type").toLowerCase();
	if (!contentType.includes("application/json")) {
		return response.text;
	}

	try {
		return JSON.parse(response.text);
	} catch {
		return response.text;
	}
}

function extractTranscript(payload: unknown): string {
	if (typeof payload === "string") {
		return payload.trim();
	}

	if (!isRecord(payload)) {
		return "";
	}

	const directText = payload.text;
	if (typeof directText === "string" && directText.trim().length > 0) {
		return directText.trim();
	}

	const dataText = payload.data;
	if (isRecord(dataText) && typeof dataText.text === "string" && dataText.text.trim().length > 0) {
		return dataText.text.trim();
	}

	const results = payload.results;
	if (!isRecord(results)) {
		return "";
	}

	const channels = getArrayField(results, "channels");
	if (channels.length === 0) {
		return "";
	}

	const channel = channels[0];
	if (!isRecord(channel)) {
		return "";
	}

	const alternatives = getArrayField(channel, "alternatives");
	if (alternatives.length === 0) {
		return "";
	}

	const alternative = alternatives[0];
	if (isRecord(alternative) && typeof alternative.transcript === "string") {
		return alternative.transcript.trim();
	}

	return "";
}

function getArrayField(source: Record<string, unknown>, field: string): unknown[] {
	const value = source[field];
	return Array.isArray(value) ? value : [];
}

function extractApiError(payload: unknown, fallback: string): string {
	if (typeof payload === "string") {
		const text = payload.trim();
		return text.length > 0 ? text : fallback;
	}

	if (!isRecord(payload)) {
		return fallback || "Unknown error";
	}

	const message = payload.error;
	if (typeof message === "string" && message.trim().length > 0) {
		return message.trim();
	}
	if (isRecord(message) && typeof message.message === "string" && message.message.trim().length > 0) {
		return message.message.trim();
	}

	if (typeof payload.message === "string" && payload.message.trim().length > 0) {
		return payload.message.trim();
	}

	return fallback || "Unknown error";
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim();
	}
	return "Unknown network error";
}

function createEndpointCandidates(url: URL): URL[] {
	const hostname = normalizeHost(url.hostname);
	if (!LOOPBACK_HOST_SET.has(hostname)) {
		return [url];
	}

	const hostnames: string[] = [];
	const add = (value: string): void => {
		const canonicalHost = toCanonicalHost(value);
		if (!hostnames.includes(canonicalHost)) {
			hostnames.push(canonicalHost);
		}
	};

	add(url.hostname);
	for (const loopbackHost of VOICE_LOOPBACK_HOST_CANDIDATES) {
		add(loopbackHost);
	}

	return hostnames.map((candidateHost) => {
		const clone = new URL(url.toString());
		clone.host = url.port.length > 0 ? `${candidateHost}:${url.port}` : candidateHost;
		return clone;
	});
}

function normalizeHost(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}
	return normalized;
}

function toCanonicalHost(hostname: string): string {
	const normalized = normalizeHost(hostname);
	if (normalized === "::1") {
		return "[::1]";
	}
	return normalized;
}

function getHeader(headers: Record<string, string>, key: string): string {
	const direct = headers[key];
	if (typeof direct === "string") {
		return direct;
	}

	const normalizedKey = key.toLowerCase();
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === normalizedKey) {
			return value;
		}
	}
	return "";
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	let totalLength = 0;
	for (const chunk of chunks) {
		totalLength += chunk.length;
	}

	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
