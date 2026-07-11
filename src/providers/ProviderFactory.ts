import { CodexCliProvider } from "./CodexCliProvider";
import type { AIRefinerSettings, ApiProviderId, LocalProviderId } from "../settings/types";
import { GeminiCliProvider } from "./GeminiCliProvider";
import { HttpApiProvider } from "./HttpApiProvider";
import type { IAIProvider } from "./IAIProvider";
import { OllamaLocalProvider } from "./OllamaLocalProvider";
import { getEffectiveProviderForCurrentPlatform } from "./providerAvailability";

export class ProviderFactory {
	create(settings: AIRefinerSettings): IAIProvider {
		// The stored preference may be a desktop-only provider while running on
		// mobile; resolve the platform-appropriate provider without persisting it.
		const effectiveProvider = getEffectiveProviderForCurrentPlatform(settings.activeProvider);

		switch (effectiveProvider) {
			case "gemini-cli":
				return new GeminiCliProvider(settings.geminiCli);
			case "codex-cli":
				return new CodexCliProvider(settings.codexCli);
			case "ollama-local":
				return new OllamaLocalProvider(settings.ollamaLocal);
			case "custom-api":
				return new HttpApiProvider(settings.customApi);
			default:
				return assertNever(effectiveProvider);
		}
	}
}

function assertNever(value: ApiProviderId | LocalProviderId | "gemini-cli" | "codex-cli"): never {
	void value;
	throw new Error("Unknown AI provider.");
}
