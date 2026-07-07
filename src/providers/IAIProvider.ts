export interface ProviderGenerateOptions {
	signal?: AbortSignal;
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
