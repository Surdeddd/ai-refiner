// Minimal runtime stub for the `obsidian` module, used only by unit tests.
// The real package is types-only; these exports cover the values that pure
// logic modules pull in at import time.

export const Platform = {
	isDesktopApp: true,
	isMobileApp: false,
	isDesktop: true,
	isMobile: false,
	isWin: false,
	isMacOS: true,
	isLinux: false,
	isIosApp: false,
	isAndroidApp: false,
};

export function getLanguage(): string {
	return "en";
}

export class Notice {
	constructor(public readonly message: string) {}
}

export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is not available in unit tests; mock it per test.");
}
