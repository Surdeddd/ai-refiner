import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceRecorder } from "../src/voice/VoiceRecorder";
import type { Translator } from "../src/i18n";

const t: Translator = ((key: string) => key) as Translator;

class FakeMediaRecorder {
	static instances: FakeMediaRecorder[] = [];
	state: "inactive" | "recording" = "inactive";
	mimeType = "";
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onerror: (() => void) | null = null;
	onstop: (() => void) | null = null;

	constructor(public readonly stream: unknown) {
		FakeMediaRecorder.instances.push(this);
	}

	static isTypeSupported(): boolean {
		// Force the plain `new MediaRecorder(stream)` path (no PCM fallback, since
		// no AudioContext is defined in the test environment).
		return false;
	}

	start(): void {
		this.state = "recording";
	}

	requestData(): void {
		// no-op
	}

	stop(): void {
		this.state = "inactive";
		this.onstop?.();
	}
}

interface FakeStream {
	tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
	getTracks(): Array<{ stop: () => void }>;
}

function createFakeStream(): FakeStream {
	const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
	return { tracks, getTracks: () => tracks };
}

interface Harness {
	recorder: VoiceRecorder;
	notices: string[];
	results: Blob[];
	stateChanges: number;
	getUserMedia: ReturnType<typeof vi.fn>;
	// start() awaits the permission check before calling getUserMedia; helpers must
	// wait for the actual call before settling its promise.
	waitForUserMediaRequest(): Promise<void>;
	resolveUserMedia(stream: FakeStream): Promise<void>;
	rejectUserMedia(error: Error): Promise<void>;
}

function createHarness(): Harness {
	let resolvePending: (stream: unknown) => void = () => undefined;
	let rejectPending: (error: Error) => void = () => undefined;
	const getUserMedia = vi.fn(
		() => new Promise((resolve, reject) => {
			resolvePending = resolve;
			rejectPending = reject;
		}),
	);

	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
	// getAudioContextCtor() probes window; expose a bare object with no AudioContext
	// so the PCM path is reported unsupported and MediaRecorder is used.
	vi.stubGlobal("window", globalThis);

	const waitForUserMediaRequest = async (): Promise<void> => {
		for (let i = 0; i < 50 && getUserMedia.mock.calls.length === 0; i += 1) {
			await flushMicrotasks();
		}
		expect(getUserMedia).toHaveBeenCalled();
	};

	const harness: Harness = {
		notices: [],
		results: [],
		stateChanges: 0,
		getUserMedia,
		recorder: null as unknown as VoiceRecorder,
		waitForUserMediaRequest,
		resolveUserMedia: async (stream) => {
			await waitForUserMediaRequest();
			resolvePending(stream);
			await flushMicrotasks();
		},
		rejectUserMedia: async (error) => {
			await waitForUserMediaRequest();
			rejectPending(error);
			await flushMicrotasks();
		},
	};

	harness.recorder = new VoiceRecorder(t, {
		onRecordingStateChange: () => {
			harness.stateChanges += 1;
		},
		onResult: (audio) => {
			harness.results.push(audio);
		},
		onNotice: (message) => {
			harness.notices.push(message);
		},
	});
	return harness;
}

async function flushMicrotasks(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	FakeMediaRecorder.instances = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("VoiceRecorder lifecycle", () => {
	it("moves idle -> starting -> recording on a successful start", async () => {
		const harness = createHarness();
		const started = harness.recorder.start();
		expect(harness.recorder.getState()).toBe("starting");

		await harness.resolveUserMedia(createFakeStream());
		await started;

		expect(harness.recorder.getState()).toBe("recording");
		expect(harness.recorder.isRecording).toBe(true);
	});

	it("ignores a second start() while the first is awaiting the permission prompt", async () => {
		const harness = createHarness();
		const first = harness.recorder.start();
		const second = harness.recorder.start();

		await harness.waitForUserMediaRequest();
		expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

		await harness.resolveUserMedia(createFakeStream());
		await Promise.all([first, second]);

		expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
		expect(FakeMediaRecorder.instances).toHaveLength(1);
		expect(harness.recorder.getState()).toBe("recording");
	});

	it("ignores start() while already recording", async () => {
		const harness = createHarness();
		const first = harness.recorder.start();
		await harness.resolveUserMedia(createFakeStream());
		await first;

		await harness.recorder.start();
		expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
	});

	it("stops a stream granted after dispose() (permission prompt race)", async () => {
		const harness = createHarness();
		const started = harness.recorder.start();
		expect(harness.recorder.getState()).toBe("starting");

		// The OS permission prompt is open (getUserMedia pending) when the host closes.
		await harness.waitForUserMediaRequest();
		harness.recorder.dispose();
		expect(harness.recorder.getState()).toBe("disposed");

		const stream = createFakeStream();
		await harness.resolveUserMedia(stream);
		await started;

		for (const track of stream.tracks) {
			expect(track.stop).toHaveBeenCalledTimes(1);
		}
		expect(harness.recorder.getState()).toBe("disposed");
		expect(harness.recorder.isRecording).toBe(false);
		expect(FakeMediaRecorder.instances).toHaveLength(0);
	});

	it("releases all tracks when disposed mid-recording and emits no result", async () => {
		const harness = createHarness();
		const stream = createFakeStream();
		const started = harness.recorder.start();
		await harness.resolveUserMedia(stream);
		await started;
		expect(harness.recorder.getState()).toBe("recording");

		harness.recorder.dispose();

		for (const track of stream.tracks) {
			expect(track.stop).toHaveBeenCalledTimes(1);
		}
		expect(harness.recorder.getState()).toBe("disposed");
		await flushMicrotasks();
		expect(harness.results).toHaveLength(0);
		expect(harness.notices).toHaveLength(0);
	});

	it("refuses to start after dispose()", async () => {
		const harness = createHarness();
		harness.recorder.dispose();

		await harness.recorder.start();

		expect(harness.getUserMedia).not.toHaveBeenCalled();
		expect(harness.recorder.getState()).toBe("disposed");
	});

	it("returns to idle and reports a notice when the microphone is denied", async () => {
		const harness = createHarness();
		const started = harness.recorder.start();
		await harness.rejectUserMedia(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
		await started;

		expect(harness.recorder.getState()).toBe("idle");
		expect(harness.notices).toHaveLength(1);

		// Recoverable: a later start() is allowed again.
		const restarted = harness.recorder.start();
		await flushMicrotasks();
		expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
		await harness.resolveUserMedia(createFakeStream());
		await restarted;
	});

	it("delivers the recorded audio via onResult and returns to idle", async () => {
		const harness = createHarness();
		const started = harness.recorder.start();
		await harness.resolveUserMedia(createFakeStream());
		await started;

		const recorderInstance = FakeMediaRecorder.instances[0];
		expect(recorderInstance).toBeDefined();
		recorderInstance?.ondataavailable?.({ data: new Blob(["audio-bytes"]) });

		harness.recorder.stop(false);
		await flushMicrotasks();

		expect(harness.results).toHaveLength(1);
		expect(harness.recorder.getState()).toBe("idle");
	});

	it("discards the recording on stop(true)", async () => {
		const harness = createHarness();
		const started = harness.recorder.start();
		await harness.resolveUserMedia(createFakeStream());
		await started;

		const recorderInstance = FakeMediaRecorder.instances[0];
		recorderInstance?.ondataavailable?.({ data: new Blob(["audio-bytes"]) });

		harness.recorder.stop(true);
		await flushMicrotasks();

		expect(harness.results).toHaveLength(0);
		expect(harness.recorder.getState()).toBe("idle");
	});
});
