import { Platform } from "obsidian";
import { unique } from "../utils/api";
import type { IAIProvider, ProviderGenerateOptions } from "./IAIProvider";
import { ProviderAbortError, throwIfAborted } from "./IAIProvider";

type SpawnProcess = (
	command: string,
	args: string[],
	options: { stdio: ["pipe", "pipe", "pipe"]; windowsHide: boolean },
) => ChildProcessLike;

interface ChildProcessLike {
	stdout: StreamLike;
	stderr: StreamLike;
	stdin: WritableStreamLike;
	kill(signal?: string): void;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
}

interface StreamLike {
	on(event: "data", listener: (chunk: Uint8Array | string) => void): void;
}

interface WritableStreamLike {
	on(event: "error", listener: (error: Error) => void): void;
	write(chunk: string): void;
	end(): void;
}

declare const require: ((id: string) => unknown) | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;

let cachedSpawnProcess: SpawnProcess | null = null;

// GUI apps on macOS/Linux do not inherit the login-shell PATH, so bare command
// names are resolved against these directories as extra spawn candidates.
const COMMON_UNIX_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const WINDOWS_COMMAND_NOT_FOUND_EXIT_CODE = 9009;

export interface CliProviderConfig {
	executablePath: string;
	argsJson: string;
	timeoutMs: number;
}

interface ParsedCliConfig {
	executablePath: string;
	args: string[];
	timeoutMs: number;
}

interface CliProcessProviderOptions {
	displayName: string;
	fallbackExecutables?: string[];
}

export class CliProcessProvider implements IAIProvider {
	private readonly config: ParsedCliConfig;

	constructor(
		private readonly options: CliProcessProviderOptions,
		config: CliProviderConfig,
	) {
		this.config = this.parseConfig(config);
	}

	async generate(text: string, instruction: string, options?: ProviderGenerateOptions): Promise<string> {
		throwIfAborted(options?.signal);
		const prompt = `${instruction.trim()}\n\n${text}`;
		const executableCandidates = this.getExecutableCandidates();

		let notFoundExecutables: string[] = [];
		for (const executablePath of executableCandidates) {
			try {
				return await this.runCommand(executablePath, prompt, options?.signal);
			} catch (error: unknown) {
				if (error instanceof CommandNotFoundError) {
					notFoundExecutables.push(error.executablePath);
					continue;
				}
				throw error;
			}
		}

		notFoundExecutables = unique(notFoundExecutables);
		throw new Error(
			`${this.options.displayName} command not found. Tried: ${notFoundExecutables.join(", ")}. ` +
			"Use an absolute binary path or local preset in settings.",
		);
	}

	private runCommand(executablePath: string, prompt: string, abortSignal?: AbortSignal): Promise<string> {
		const spawnProcess = getSpawnProcess(this.options.displayName);
		const target = buildSpawnTarget(executablePath, this.config.args);

		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
			let abortHandler: (() => void) | null = null;

			const child = spawnProcess(target.file, target.args, {
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});

			const settle = (error?: Error, result?: string): void => {
				if (settled) {
					return;
				}

				settled = true;
				if (timeoutHandle !== null) {
					clearTimeout(timeoutHandle);
					timeoutHandle = null;
				}
				if (abortHandler && abortSignal) {
					abortSignal.removeEventListener("abort", abortHandler);
					abortHandler = null;
				}

				if (error) {
					reject(error);
					return;
				}

				resolve(result ?? "");
			};

			if (abortSignal?.aborted) {
				child.kill("SIGTERM");
				settle(new ProviderAbortError());
				return;
			}

			if (abortSignal) {
				abortHandler = () => {
					child.kill("SIGTERM");
					settle(new ProviderAbortError());
				};
				abortSignal.addEventListener("abort", abortHandler, { once: true });
			}

			timeoutHandle = setTimeout(() => {
				child.kill("SIGTERM");
				settle(new Error(`${this.options.displayName} timed out after ${this.config.timeoutMs} ms.`));
			}, this.config.timeoutMs);

			child.on("error", (error: Error) => {
				if (isErrnoException(error) && error.code === "ENOENT") {
					settle(new CommandNotFoundError(executablePath));
					return;
				}

				settle(new Error(`Failed to start ${this.options.displayName}: ${error.message}`));
			});

			child.stdout.on("data", (chunk: Uint8Array | string) => {
				stdout += chunk.toString();
			});

			child.stderr.on("data", (chunk: Uint8Array | string) => {
				stderr += chunk.toString();
			});

			child.stdin.on("error", (error: Error) => {
				settle(new Error(`Failed to send prompt to ${this.options.displayName}: ${error.message}`));
			});

			child.on("close", (code: number | null, closeSignal: string | null) => {
				if (settled) {
					return;
				}

				if (abortSignal?.aborted) {
					settle(new ProviderAbortError());
					return;
				}

				if (closeSignal) {
					settle(new Error(`${this.options.displayName} process terminated by signal: ${closeSignal}.`));
					return;
				}

				if (code !== 0) {
					if (target.usesCmdWrapper && code === WINDOWS_COMMAND_NOT_FOUND_EXIT_CODE) {
						settle(new CommandNotFoundError(executablePath));
						return;
					}

					const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
					settle(new Error(`${this.options.displayName} failed: ${details}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					const details = stderr.trim();
					settle(
						new Error(
							details
								? `${this.options.displayName} returned empty output: ${details}`
								: `${this.options.displayName} returned empty output.`,
						),
					);
					return;
				}

				settle(undefined, output);
			});

			child.stdin.write(prompt);
			child.stdin.end();
		});
	}

	private getExecutableCandidates(): string[] {
		const configured = this.config.executablePath;
		const candidates = [configured, ...(this.options.fallbackExecutables ?? [])];

		if (isBareCommand(configured) && !Platform.isWin) {
			for (const binDir of COMMON_UNIX_BIN_DIRS) {
				candidates.push(`${binDir}/${configured}`);
			}

			const home = getHomeDir();
			if (home) {
				candidates.push(`${home}/.local/bin/${configured}`, `${home}/bin/${configured}`);
			}
		}

		return unique(candidates);
	}

	private parseConfig(config: CliProviderConfig): ParsedCliConfig {
		const executablePath = config.executablePath.trim();
		if (!executablePath) {
			throw new Error(`${this.options.displayName} executable path is required.`);
		}

		const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
			? Math.floor(config.timeoutMs)
			: 60_000;

		return {
			executablePath,
			args: this.parseArgs(config.argsJson),
			timeoutMs,
		};
	}

	private parseArgs(argsJson: string): string[] {
		const normalized = argsJson.trim();
		if (!normalized) {
			return [];
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(normalized);
		} catch {
			throw new Error(`${this.options.displayName} args must be a valid JSON array.`);
		}

		if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === "string")) {
			throw new Error(`${this.options.displayName} args must be a JSON array of strings.`);
		}

		return parsed;
	}
}

class CommandNotFoundError extends Error {
	constructor(public readonly executablePath: string) {
		super(`Command not found: ${executablePath}`);
	}
}

interface ErrnoException {
	code?: string;
}

function isErrnoException(value: unknown): value is ErrnoException {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	return "code" in value;
}

function isBareCommand(path: string): boolean {
	return !path.includes("/") && !path.includes("\\");
}

function getHomeDir(): string {
	if (typeof process === "undefined") {
		return "";
	}
	return process.env?.["HOME"]?.trim() ?? "";
}

interface SpawnTarget {
	file: string;
	args: string[];
	usesCmdWrapper: boolean;
}

// Node refuses to spawn .cmd/.bat scripts directly and CreateProcess only
// resolves .exe from PATH, so npm shims (codex.cmd, gemini.cmd, npx.cmd) and
// bare names on Windows are executed through cmd.exe.
function buildSpawnTarget(executablePath: string, args: string[]): SpawnTarget {
	const lower = executablePath.toLowerCase();
	const needsCmdWrapper = Platform.isWin
		&& (isBareCommand(executablePath) || lower.endsWith(".cmd") || lower.endsWith(".bat"));
	if (needsCmdWrapper) {
		return {
			file: "cmd.exe",
			args: ["/d", "/s", "/c", executablePath, ...args],
			usesCmdWrapper: true,
		};
	}

	return { file: executablePath, args, usesCmdWrapper: false };
}

function getSpawnProcess(displayName: string): SpawnProcess {
	if (cachedSpawnProcess) {
		return cachedSpawnProcess;
	}

	if (typeof require !== "function") {
		throw new Error(`${displayName} is unavailable on this platform. Use API provider settings.`);
	}

	try {
		// eslint-disable-next-line import/no-nodejs-modules -- lazy desktop-only import to keep mobile plugin load safe.
		const module = require("child_process") as { spawn?: SpawnProcess };
		if (typeof module.spawn !== "function") {
			throw new Error("Missing spawn function.");
		}

		cachedSpawnProcess = module.spawn;
		return cachedSpawnProcess;
	} catch {
		throw new Error(`${displayName} is unavailable on this platform. Use API provider settings.`);
	}
}
