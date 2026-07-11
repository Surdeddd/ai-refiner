import type { Translator } from "../../i18n";
import { ProviderAbortError } from "../../providers/IAIProvider";

export function isAbortError(error: unknown): boolean {
	return error instanceof ProviderAbortError
		|| (error instanceof Error && error.name === "AbortError");
}

export function getErrorMessage(error: unknown, t: Translator): string {
	return error instanceof Error ? error.message : t("error.refineRequestFailedFallback");
}
