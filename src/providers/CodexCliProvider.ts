import type { CodexCliConfig } from "../settings/types";
import { CliProcessProvider } from "./CliProcessProvider";
import { normalizeCliArgsForExecutable } from "./cliPresets";

export class CodexCliProvider extends CliProcessProvider {
	constructor(config: CodexCliConfig) {
		super(
			{
				displayName: "Codex CLI",
				fallbackExecutables: ["/Applications/Codex.app/Contents/Resources/codex"],
			},
			{
				...config,
				argsJson: normalizeCliArgsForExecutable("codex-cli", config.executablePath, config.argsJson),
			},
		);
	}
}
