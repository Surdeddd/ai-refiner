import { CodexCliProvider } from "./CodexCliProvider";
import type { AIRefinerSettings, ApiProviderId, LocalProviderId, ProviderId } from "../settings/types";
import { GeminiCliProvider } from "./GeminiCliProvider";
import { HttpApiProvider } from "./HttpApiProvider";
import type { IAIProvider } from "./IAIProvider";
import { OllamaLocalProvider } from "./OllamaLocalProvider";
import { getEffectiveProviderForCurrentPlatform } from "./providerAvailability";

// Per-invocation routing override (e.g. a quick prompt pinned to a provider/model).
// The provider override goes through the same platform fallback as the global
// preference; the model override applies to API/local providers only.
export interface ProviderOverride {
	providerId?: ProviderId;
	model?: string;
}

export class ProviderFactory {
	create(settings: AIRefinerSettings, override?: ProviderOverride): IAIProvider {
		// The requested provider may be desktop-only while running on mobile;
		// resolve the platform-appropriate provider without persisting it.
		const requestedProvider = override?.providerId ?? settings.activeProvider;
		const effectiveProvider = getEffectiveProviderForCurrentPlatform(requestedProvider);
		const model = override?.model?.trim();

		switch (effectiveProvider) {
			case "gemini-cli":
				return new GeminiCliProvider(settings.geminiCli);
			case "codex-cli":
				return new CodexCliProvider(settings.codexCli);
			case "ollama-local":
				return new OllamaLocalProvider(
					model ? { ...settings.ollamaLocal, model } : settings.ollamaLocal,
				);
			case "custom-api":
				return new HttpApiProvider(
					model ? { ...settings.customApi, model } : settings.customApi,
				);
			default:
				return assertNever(effectiveProvider);
		}
	}
}

function assertNever(value: ApiProviderId | LocalProviderId | "gemini-cli" | "codex-cli"): never {
	void value;
	throw new Error("Unknown AI provider.");
}
