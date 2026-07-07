import type { GeminiCliConfig } from "../settings/types";
import { CliProcessProvider } from "./CliProcessProvider";
import { normalizeCliArgsForExecutable } from "./cliPresets";

export class GeminiCliProvider extends CliProcessProvider {
	constructor(config: GeminiCliConfig) {
		super(
			{ displayName: "Gemini CLI" },
			{
				...config,
				argsJson: normalizeCliArgsForExecutable("gemini-cli", config.executablePath, config.argsJson),
			},
		);
	}
}
