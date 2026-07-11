export interface ProviderGenerateOptions {
	signal?: AbortSignal;
	// Incremental output deltas, when the transport supports streaming. The resolved
	// promise value is ALWAYS the complete text — onChunk is presentation-only.
	onChunk?: (delta: string) => void;
}

export interface IAIProvider {
	generate(text: string, instruction: string, options?: ProviderGenerateOptions): Promise<string>;
}

export class ProviderAbortError extends Error {
	constructor(message = "Request was cancelled.") {
		super(message);
		this.name = "ProviderAbortError";
	}
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new ProviderAbortError();
	}
}
