import type { Translator } from "../i18n";
import type { ProviderId } from "./types";

export function getProviderLabel(providerId: ProviderId, t: Translator): string {
	switch (providerId) {
		case "gemini-cli":
			return t("settings.provider.geminiCli");
		case "codex-cli":
			return t("settings.provider.codexCli");
		case "ollama-local":
			return t("settings.provider.ollamaLocal");
		case "custom-api":
			return t("settings.provider.customApi");
		default:
			return assertNever(providerId);
	}
}

function assertNever(value: never): never {
	void value;
	throw new Error("Unsupported provider id.");
}
