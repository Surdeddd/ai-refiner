import { describe, expect, it, vi } from "vitest";
import { CliProcessProvider } from "../src/providers/CliProcessProvider";
import { ProviderAbortError } from "../src/providers/IAIProvider";
import { detachOnAbort, requestUrlWithSignal } from "../src/utils/api";

// CliProcessProvider schedules its timeout via window.setTimeout; provide a window
// alias in the node test environment.
if (typeof globalThis.window === "undefined") {
	(globalThis as Record<string, unknown>).window = globalThis;
}

interface FakeChildControls {
	killSignals: string[];
	emitClose(code: number | null, signal?: string | null): void;
	emitError(error: Error): void;
}

function createFakeSpawn(): { spawn: never; controls: FakeChildControls; calls: number } {
	const state = {
		killSignals: [] as string[],
		closeListeners: [] as Array<(code: number | null, signal: string | null) => void>,
		errorListeners: [] as Array<(error: Error) => void>,
		calls: 0,
	};

	const child = {
		stdout: { on: () => undefined },
		stderr: { on: () => undefined },
		stdin: { on: () => undefined, write: () => undefined, end: () => undefined },
		kill: (signal?: string) => {
			state.killSignals.push(signal ?? "");
		},
		on: (event: "error" | "close", listener: never) => {
			if (event === "close") {
				state.closeListeners.push(listener);
			} else {
				state.errorListeners.push(listener);
			}
		},
	};

	const spawn = (() => {
		state.calls += 1;
		return child;
	}) as never;

	return {
		spawn,
		get calls() {
			return state.calls;
		},
		controls: {
			killSignals: state.killSignals,
			emitClose: (code, signal = null) => {
				for (const listener of state.closeListeners) {
					listener(code, signal);
				}
			},
			emitError: (error) => {
				for (const listener of state.errorListeners) {
					listener(error);
				}
			},
		},
	};
}

const CLI_CONFIG = { executablePath: "/usr/local/bin/fake-cli", argsJson: "[]", timeoutMs: 60_000 };

describe("CLI cancellation (real process termination)", () => {
	it("kills the child with SIGTERM on abort and rejects with ProviderAbortError", async () => {
		const fake = createFakeSpawn();
		const provider = new CliProcessProvider(
			{ displayName: "Fake CLI", spawnProcess: fake.spawn },
			CLI_CONFIG,
		);
		const controller = new AbortController();

		const pending = provider.generate("text", "instruction", { signal: controller.signal });
		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);
		expect(fake.controls.killSignals).toEqual(["SIGTERM"]);

		// The killed process closing afterwards must not double-settle or throw.
		fake.controls.emitClose(null, "SIGTERM");
	});

	it("does not spawn at all when the signal is already aborted", async () => {
		const fake = createFakeSpawn();
		const provider = new CliProcessProvider(
			{ displayName: "Fake CLI", spawnProcess: fake.spawn },
			CLI_CONFIG,
		);
		const controller = new AbortController();
		controller.abort();

		await expect(
			provider.generate("text", "instruction", { signal: controller.signal }),
		).rejects.toBeInstanceOf(ProviderAbortError);
		expect(fake.calls).toBe(0);
	});

	it("kills the child on timeout", async () => {
		const fake = createFakeSpawn();
		const provider = new CliProcessProvider(
			{ displayName: "Fake CLI", spawnProcess: fake.spawn },
			{ ...CLI_CONFIG, timeoutMs: 10 },
		);

		await expect(provider.generate("text", "instruction")).rejects.toThrow(/timed out after 10 ms/);
		expect(fake.controls.killSignals).toEqual(["SIGTERM"]);
	});
});

describe("HTTP cancellation (detach, not transport abort)", () => {
	it("rejects with ProviderAbortError on abort while the request is pending", async () => {
		const controller = new AbortController();
		const never = new Promise<string>(() => undefined);

		const pending = detachOnAbort(never, controller.signal);
		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);
	});

	it("swallows a late rejection of the detached request (no unhandled rejection)", async () => {
		const controller = new AbortController();
		let rejectUnderlying: (error: Error) => void = () => undefined;
		const underlying = new Promise<string>((_resolve, reject) => {
			rejectUnderlying = reject;
		});

		const pending = detachOnAbort(underlying, controller.signal);
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);

		// The real request settles later; vitest fails this test if it surfaces
		// as an unhandled rejection.
		rejectUnderlying(new Error("late network failure"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("never issues the request when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		// The obsidian stub's requestUrl throws a distinctive error when actually
		// invoked; getting ProviderAbortError proves requestUrl was never called.
		await expect(
			requestUrlWithSignal({ url: "http://127.0.0.1:1/never" }, controller.signal),
		).rejects.toBeInstanceOf(ProviderAbortError);
	});

	it("resolves normally when the signal never fires", async () => {
		const controller = new AbortController();
		const value = await detachOnAbort(Promise.resolve("ok"), controller.signal);
		expect(value).toBe("ok");
	});
});

describe("no retries after cancellation", () => {
	it("CLI candidate loop stops on abort instead of trying the next executable", async () => {
		const fake = createFakeSpawn();
		const spawnSpy = vi.fn(fake.spawn);
		const provider = new CliProcessProvider(
			// Bare command name would normally expand to several PATH candidates.
			{ displayName: "Fake CLI", spawnProcess: spawnSpy as never, fallbackExecutables: ["fake-b"] },
			{ ...CLI_CONFIG, executablePath: "fake-a" },
		);
		const controller = new AbortController();

		const pending = provider.generate("text", "instruction", { signal: controller.signal });
		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);
		expect(spawnSpy).toHaveBeenCalledTimes(1);
	});
});
