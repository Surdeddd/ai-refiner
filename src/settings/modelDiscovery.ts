export type DiscoveryProviderId = "custom-api" | "ollama-local";

export type DiscoveryPhase = "idle" | "loading" | "loaded" | "error";

export interface DiscoveryState {
	phase: DiscoveryPhase;
	models: string[];
	errorMessage: string | null;
}

export interface ModelDiscoveryOptions {
	// Performs the actual network fetch for one provider.
	fetchModels: (providerId: DiscoveryProviderId) => Promise<string[]>;
	// Fingerprint of the connection settings (endpoint + credential) a request was
	// started with. Held only in the request closure for its lifetime — never stored
	// in long-lived maps, cache keys, or log output.
	getConfigSnapshot: (providerId: DiscoveryProviderId) => string;
	// Notifies the UI that getState(providerId) changed.
	onStateChange: (providerId: DiscoveryProviderId) => void;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const IDLE_STATE: DiscoveryState = { phase: "idle", models: [], errorMessage: null };

// Model discovery runs ONLY on explicit user action (the localized "Detect models"
// button) — never on settings-tab open or while typing into endpoint/token fields.
// Stale responses are discarded via a per-provider generation counter plus a
// config-snapshot comparison, so a result started against an old endpoint/token can
// never be applied after the user edits them.
export class ModelDiscoveryController {
	private readonly states = new Map<DiscoveryProviderId, DiscoveryState>();
	private readonly generations = new Map<DiscoveryProviderId, number>();
	private readonly timeoutMs: number;

	constructor(private readonly options: ModelDiscoveryOptions) {
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	getState(providerId: DiscoveryProviderId): DiscoveryState {
		return this.states.get(providerId) ?? IDLE_STATE;
	}

	// Drops any in-flight request's right to apply its result and resets the state.
	// Called when the user edits endpoint/token, and on dispose.
	invalidate(providerId: DiscoveryProviderId): void {
		this.bumpGeneration(providerId);
		if (this.states.has(providerId)) {
			this.states.set(providerId, IDLE_STATE);
			this.options.onStateChange(providerId);
		}
	}

	dispose(): void {
		for (const providerId of this.generations.keys()) {
			this.bumpGeneration(providerId);
		}
		this.states.clear();
	}

	isLoading(providerId: DiscoveryProviderId): boolean {
		return this.getState(providerId).phase === "loading";
	}

	async detect(providerId: DiscoveryProviderId): Promise<void> {
		if (this.isLoading(providerId)) {
			return;
		}

		const generation = this.bumpGeneration(providerId);
		const startSnapshot = this.options.getConfigSnapshot(providerId);
		this.states.set(providerId, { phase: "loading", models: [], errorMessage: null });
		this.options.onStateChange(providerId);

		let nextState: DiscoveryState;
		try {
			const models = await this.withTimeout(this.options.fetchModels(providerId));
			nextState = { phase: "loaded", models, errorMessage: null };
		} catch (error: unknown) {
			nextState = { phase: "error", models: [], errorMessage: toErrorMessage(error) };
		}

		// Stale guard: another detect() started, invalidate() ran, or the user
		// changed endpoint/token while this request was in flight.
		if (this.generations.get(providerId) !== generation) {
			return;
		}
		if (this.options.getConfigSnapshot(providerId) !== startSnapshot) {
			this.states.set(providerId, IDLE_STATE);
			this.options.onStateChange(providerId);
			return;
		}

		this.states.set(providerId, nextState);
		this.options.onStateChange(providerId);
	}

	private bumpGeneration(providerId: DiscoveryProviderId): number {
		const next = (this.generations.get(providerId) ?? 0) + 1;
		this.generations.set(providerId, next);
		return next;
	}

	private async withTimeout(promise: Promise<string[]>): Promise<string[]> {
		let timer: number | null = null;
		try {
			return await Promise.race([
				promise,
				new Promise<never>((_resolve, reject) => {
					timer = window.setTimeout(
						() => reject(new Error(`Model detection timed out after ${this.timeoutMs} ms.`)),
						this.timeoutMs,
					);
				}),
			]);
		} finally {
			if (timer !== null) {
				window.clearTimeout(timer);
			}
		}
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim();
	}
	return "Unknown error";
}
