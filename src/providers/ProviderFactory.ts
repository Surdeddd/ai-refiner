import { CodexCliProvider } from "./CodexCliProvider";
import type { AIRefinerSettings, ApiProviderId, LocalProviderId } from "../settings/types";
import { GeminiCliProvider } from "./GeminiCliProvider";
import { HttpApiProvider } from "./HttpApiProvider";
import type { IAIProvider } from "./IAIProvider";
import { OllamaLocalProvider } from "./OllamaLocalProvider";
import { isProviderSupportedOnCurrentPlatform } from "./providerAvailability";

export class ProviderFactory {
	create(settings: AIRefinerSettings): IAIProvider {
		if (!isProviderSupportedOnCurrentPlatform(settings.activeProvider)) {
			throw new Error(`Provider "${settings.activeProvider}" is not supported on this platform.`);
		}

		switch (settings.activeProvider) {
			case "gemini-cli":
				return new GeminiCliProvider(settings.geminiCli);
			case "codex-cli":
				return new CodexCliProvider(settings.codexCli);
			case "ollama-local":
				return new OllamaLocalProvider(settings.ollamaLocal);
			case "custom-api":
				return new HttpApiProvider(settings.customApi);
			default:
				return assertNever(settings.activeProvider);
		}
	}
}

function assertNever(value: ApiProviderId | LocalProviderId | "gemini-cli" | "codex-cli"): never {
	void value;
	throw new Error("Unknown AI provider.");
}
