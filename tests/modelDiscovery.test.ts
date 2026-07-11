import { describe, expect, it, vi } from "vitest";
import { ModelDiscoveryController } from "../src/settings/modelDiscovery";

// The controller schedules its timeout via window.setTimeout; alias window in node.
if (typeof globalThis.window === "undefined") {
	(globalThis as Record<string, unknown>).window = globalThis;
}

interface Harness {
	controller: ModelDiscoveryController;
	fetchModels: ReturnType<typeof vi.fn>;
	setSnapshot(value: string): void;
	stateChanges: number;
}

function createHarness(options?: { timeoutMs?: number }): Harness {
	let snapshot = "endpoint-a token-a";
	const fetchModels = vi.fn();
	const harness = {
		fetchModels,
		setSnapshot: (value: string) => {
			snapshot = value;
		},
		stateChanges: 0,
	} as Harness;

	harness.controller = new ModelDiscoveryController({
		fetchModels,
		getConfigSnapshot: () => snapshot,
		onStateChange: () => {
			harness.stateChanges += 1;
		},
		timeoutMs: options?.timeoutMs,
	});
	return harness;
}

describe("ModelDiscoveryController", () => {
	it("starts idle and performs no network request until detect() is called", () => {
		const harness = createHarness();

		expect(harness.controller.getState("custom-api").phase).toBe("idle");
		harness.controller.invalidate("custom-api");
		expect(harness.fetchModels).not.toHaveBeenCalled();
	});

	it("reaches loaded state with models on success", async () => {
		const harness = createHarness();
		harness.fetchModels.mockResolvedValue(["m1", "m2"]);

		await harness.controller.detect("custom-api");

		expect(harness.controller.getState("custom-api")).toEqual({
			phase: "loaded",
			models: ["m1", "m2"],
			errorMessage: null,
		});
	});

	it("reports error state and recovers on a successful retry", async () => {
		const harness = createHarness();
		harness.fetchModels.mockRejectedValueOnce(new Error("connection refused"));
		harness.fetchModels.mockResolvedValueOnce(["m1"]);

		await harness.controller.detect("custom-api");
		expect(harness.controller.getState("custom-api").phase).toBe("error");
		expect(harness.controller.getState("custom-api").errorMessage).toBe("connection refused");

		await harness.controller.detect("custom-api");
		expect(harness.controller.getState("custom-api").phase).toBe("loaded");
	});

	it("discards a response that resolves after invalidate()", async () => {
		const harness = createHarness();
		let resolveFetch: (models: string[]) => void = () => undefined;
		harness.fetchModels.mockImplementation(
			() => new Promise<string[]>((resolve) => {
				resolveFetch = resolve;
			}),
		);

		const pending = harness.controller.detect("custom-api");
		expect(harness.controller.isLoading("custom-api")).toBe(true);

		// User edits endpoint/token while the request is in flight.
		harness.controller.invalidate("custom-api");
		resolveFetch(["stale-model"]);
		await pending;

		expect(harness.controller.getState("custom-api").phase).toBe("idle");
		expect(harness.controller.getState("custom-api").models).toEqual([]);
	});

	it("discards a response when the config snapshot changed mid-flight", async () => {
		const harness = createHarness();
		let resolveFetch: (models: string[]) => void = () => undefined;
		harness.fetchModels.mockImplementation(
			() => new Promise<string[]>((resolve) => {
				resolveFetch = resolve;
			}),
		);

		const pending = harness.controller.detect("custom-api");
		harness.setSnapshot("endpoint-B token-B");
		resolveFetch(["model-for-old-endpoint"]);
		await pending;

		expect(harness.controller.getState("custom-api").phase).toBe("idle");
		expect(harness.controller.getState("custom-api").models).toEqual([]);
	});

	it("fails with a timeout error when the endpoint never answers", async () => {
		const harness = createHarness({ timeoutMs: 10 });
		harness.fetchModels.mockImplementation(() => new Promise<string[]>(() => undefined));

		await harness.controller.detect("custom-api");

		const state = harness.controller.getState("custom-api");
		expect(state.phase).toBe("error");
		expect(state.errorMessage).toMatch(/timed out after 10 ms/);
	});

	it("ignores detect() while already loading", async () => {
		const harness = createHarness();
		let resolveFetch: (models: string[]) => void = () => undefined;
		harness.fetchModels.mockImplementation(
			() => new Promise<string[]>((resolve) => {
				resolveFetch = resolve;
			}),
		);

		const first = harness.controller.detect("custom-api");
		const second = harness.controller.detect("custom-api");
		expect(harness.fetchModels).toHaveBeenCalledTimes(1);

		resolveFetch(["m1"]);
		await Promise.all([first, second]);
		expect(harness.controller.getState("custom-api").phase).toBe("loaded");
	});

	it("keeps per-provider state independent", async () => {
		const harness = createHarness();
		harness.fetchModels.mockResolvedValue(["m1"]);

		await harness.controller.detect("custom-api");
		expect(harness.controller.getState("custom-api").phase).toBe("loaded");
		expect(harness.controller.getState("ollama-local").phase).toBe("idle");
	});
});
