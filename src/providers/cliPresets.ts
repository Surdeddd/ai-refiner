import type { CliProviderId } from "../settings/types";

interface NpxPreset {
	// npm package the CLI ships as, invoked through `npx -y <package> …`.
	packageName: string;
	// argsJson to store when the executable is the `npx` launcher.
	npxArgsJson: string;
	// argsJson to store when running the bare binary (the `-y <package>` prefix removed).
	bareArgsJson: string;
}

export const NPX_PRESETS: Record<CliProviderId, NpxPreset> = {
	"gemini-cli": {
		packageName: "@google/gemini-cli",
		npxArgsJson: "[\"-y\", \"@google/gemini-cli\"]",
		bareArgsJson: "[]",
	},
	"codex-cli": {
		packageName: "@openai/codex",
		npxArgsJson: "[\"-y\", \"@openai/codex\", \"exec\", \"--skip-git-repo-check\"]",
		bareArgsJson: "[\"exec\", \"--skip-git-repo-check\"]",
	},
};

export function isNpxExecutable(executablePath: string): boolean {
	const trimmed = executablePath.trim();
	return trimmed === "npx" || trimmed.endsWith("/npx");
}

// When the user switches from the `npx -y <package> …` preset to a bare binary
// path, drop the `-y <package>` prefix so the remaining args fit the direct
// executable. Leaves argsJson untouched for npx targets or anything unrecognized.
export function normalizeCliArgsForExecutable(
	providerId: CliProviderId,
	executablePath: string,
	argsJson: string,
): string {
	if (isNpxExecutable(executablePath)) {
		return argsJson;
	}

	const preset = NPX_PRESETS[providerId];
	try {
		const parsed: unknown = JSON.parse(argsJson);
		if (!Array.isArray(parsed) || parsed.length < 2) {
			return argsJson;
		}

		if (parsed[0] === "-y" && parsed[1] === preset.packageName) {
			const remaining = parsed.slice(2);
			return remaining.length > 0 ? JSON.stringify(remaining) : preset.bareArgsJson;
		}
	} catch {
		return argsJson;
	}

	return argsJson;
}
