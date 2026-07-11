import { Platform } from "obsidian";
import type { ProviderId } from "../settings/types";

export const PROVIDER_ORDER: ProviderId[] = [
	"gemini-cli",
	"codex-cli",
	"ollama-local",
	"custom-api",
];

const MOBILE_UNSUPPORTED_PROVIDERS = new Set<ProviderId>(["gemini-cli", "codex-cli"]);
const FALLBACK_ORDER: ProviderId[] = ["custom-api", "ollama-local", "gemini-cli", "codex-cli"];

export function isProviderSupportedOnCurrentPlatform(providerId: ProviderId): boolean {
	if (Platform.isDesktopApp) {
		return true;
	}
	return !MOBILE_UNSUPPORTED_PROVIDERS.has(providerId);
}

export function getSupportedProvidersForCurrentPlatform(
	providerOrder: ProviderId[] = PROVIDER_ORDER,
): ProviderId[] {
	return providerOrder.filter((providerId) => isProviderSupportedOnCurrentPlatform(providerId));
}

// Resolves the provider actually used on this platform WITHOUT mutating the stored
// preference: a desktop CLI choice must survive a vault round-trip through mobile,
// so callers compute this per use instead of persisting the fallback.
export function getEffectiveProviderForCurrentPlatform(
	storedProvider: ProviderId,
	providerOrder: ProviderId[] = PROVIDER_ORDER,
): ProviderId {
	if (isProviderSupportedOnCurrentPlatform(storedProvider)) {
		return storedProvider;
	}

	const supportedProviderSet = new Set(getSupportedProvidersForCurrentPlatform(providerOrder));
	for (const providerId of FALLBACK_ORDER) {
		if (supportedProviderSet.has(providerId)) {
			return providerId;
		}
	}

	return "custom-api";
}
