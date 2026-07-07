import type { Translator } from "../i18n";
import {
	VOICE_DEFAULT_SAMPLE_RATE,
	VOICE_MIN_SAMPLE_RATE,
	VOICE_PCM_BUFFER_SIZE,
	VOICE_RECORDING_MIME_CANDIDATES,
	VOICE_WAV_MIME_TYPE,
} from "./constants";

const PCM_CHANNEL_COUNT = 1;
const WAV_HEADER_SIZE = 44;
const WAV_BYTES_PER_SAMPLE = 2;
const WAV_FORMAT_PCM = 1;
const WAV_BITS_PER_SAMPLE = 16;

export interface VoiceRecorderCallbacks {
	// Fired whenever the recording state flips, so the host can refresh its UI.
	onRecordingStateChange(): void;
	// Fired with the captured audio once a (non-discarded) recording stops.
	onResult(audio: Blob): void | Promise<void>;
	// User-facing message (already translated) for the host to surface as a Notice.
	onNotice(message: string): void;
}

// Owns microphone capture: MediaRecorder where a supported container exists, and
// a ScriptProcessor/PCM-to-WAV fallback otherwise. Produces an audio Blob for the
// host to transcribe; knows nothing about the transcription endpoint or the DOM.
export class VoiceRecorder {
	private recordingMode: "media-recorder" | "pcm-wav" | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private mediaStream: MediaStream | null = null;
	private recordedChunks: BlobPart[] = [];
	private audioContext: AudioContext | null = null;
	private audioSourceNode: MediaStreamAudioSourceNode | null = null;
	// eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet capture is not consistently available in Obsidian/Electron.
	private audioProcessorNode: ScriptProcessorNode | null = null;
	private silentGainNode: GainNode | null = null;
	private pcmChunks: Float32Array[] = [];
	private pcmSampleRate = VOICE_DEFAULT_SAMPLE_RATE;
	private discardNextRecording = false;
	private recording = false;

	constructor(
		private readonly t: Translator,
		private readonly callbacks: VoiceRecorderCallbacks,
	) {}

	get isRecording(): boolean {
		return this.recording;
	}

	static isSupported(): boolean {
		return supportsAudioCapture();
	}

	async start(): Promise<void> {
		if (!supportsAudioCapture()) {
			this.callbacks.onNotice(this.t("notice.voiceRecordingNotSupported"));
			return;
		}

		const permissionState = await getMicrophonePermissionState();
		if (permissionState === "denied") {
			this.callbacks.onNotice(this.t("notice.voicePermissionDenied"));
			return;
		}

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (error: unknown) {
			this.callbacks.onNotice(getMicrophoneErrorMessage(error, this.t));
			return;
		}

		const mimeType = getPreferredRecordingMimeType();
		this.recordedChunks = [];
		this.pcmChunks = [];
		this.discardNextRecording = false;

		if (mimeType.includes("webm") || !mimeType) {
			const startedPcm = this.startPcmRecording(stream);
			if (startedPcm) {
				return;
			}
		}

		let recorder: MediaRecorder;
		try {
			recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
		} catch {
			stopMediaStream(stream);
			this.callbacks.onNotice(this.t("notice.voiceRecordingNotSupported"));
			return;
		}

		this.mediaStream = stream;
		this.mediaRecorder = recorder;
		this.recordingMode = "media-recorder";
		recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data && event.data.size > 0) {
				this.recordedChunks.push(event.data);
			}
		};
		recorder.onerror = () => {
			this.callbacks.onNotice(this.t("notice.voiceFailed"));
		};
		recorder.onstop = () => {
			void this.handleRecorderStop();
		};

		try {
			recorder.start();
		} catch {
			this.cleanup();
			this.callbacks.onNotice(this.t("notice.voiceFailed"));
			return;
		}

		this.recording = true;
		this.callbacks.onRecordingStateChange();
	}

	stop(discardRecording: boolean): void {
		if (this.recordingMode === "pcm-wav" && this.recording) {
			this.discardNextRecording = discardRecording;
			void this.handlePcmStop();
			return;
		}

		if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
			this.discardNextRecording = discardRecording;
			try {
				if (typeof this.mediaRecorder.requestData === "function") {
					this.mediaRecorder.requestData();
				}
				this.mediaRecorder.stop();
			} catch {
				this.callbacks.onNotice(this.t("notice.voiceFailed"));
				this.cleanup();
			}
		} else if (discardRecording) {
			this.cleanup();
		}

		this.callbacks.onRecordingStateChange();
	}

	// Force-stops capture and releases resources without emitting a result.
	dispose(): void {
		this.cleanup();
	}

	private startPcmRecording(stream: MediaStream): boolean {
		const AudioContextCtor = getAudioContextCtor();
		if (!AudioContextCtor) {
			stopMediaStream(stream);
			this.callbacks.onNotice(this.t("notice.voiceRecordingNotSupported"));
			return false;
		}

		let audioContext: AudioContext;
		try {
			audioContext = new AudioContextCtor();
		} catch {
			stopMediaStream(stream);
			this.callbacks.onNotice(this.t("notice.voiceRecordingNotSupported"));
			return false;
		}

		try {
			const source = audioContext.createMediaStreamSource(stream);
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback path for environments without reliable supported media container.
			const processor = audioContext.createScriptProcessor(
				VOICE_PCM_BUFFER_SIZE,
				PCM_CHANNEL_COUNT,
				PCM_CHANNEL_COUNT,
			);
			const silentGain = audioContext.createGain();
			silentGain.gain.value = 0;

			this.pcmSampleRate = Math.max(
				VOICE_MIN_SAMPLE_RATE,
				Math.floor(audioContext.sampleRate || VOICE_DEFAULT_SAMPLE_RATE),
			);
			this.pcmChunks = [];
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- See createScriptProcessor fallback note above.
			processor.onaudioprocess = (event) => {
				if (!this.recording) {
					return;
				}

				// eslint-disable-next-line @typescript-eslint/no-deprecated -- Part of ScriptProcessor fallback.
				const channel = event.inputBuffer.getChannelData(0);
				this.pcmChunks.push(new Float32Array(channel));
			};

			source.connect(processor);
			processor.connect(silentGain);
			silentGain.connect(audioContext.destination);

			this.mediaStream = stream;
			this.audioContext = audioContext;
			this.audioSourceNode = source;
			this.audioProcessorNode = processor;
			this.silentGainNode = silentGain;
			this.recordingMode = "pcm-wav";
			this.recording = true;
			this.callbacks.onRecordingStateChange();
			return true;
		} catch {
			void audioContext.close().catch(() => undefined);
			stopMediaStream(stream);
			this.callbacks.onNotice(this.t("notice.voiceRecordingNotSupported"));
			return false;
		}
	}

	private async handlePcmStop(): Promise<void> {
		const shouldDiscard = this.discardNextRecording;
		this.discardNextRecording = false;
		this.recording = false;
		this.callbacks.onRecordingStateChange();

		const samples = this.pcmChunks;
		const sampleRate = this.pcmSampleRate;
		this.cleanup();

		if (shouldDiscard) {
			return;
		}

		if (samples.length === 0) {
			this.callbacks.onNotice(this.t("notice.voiceRecordingEmpty"));
			return;
		}

		await this.callbacks.onResult(createWavBlob(samples, sampleRate));
	}

	private async handleRecorderStop(): Promise<void> {
		const shouldDiscard = this.discardNextRecording;
		this.discardNextRecording = false;
		this.recording = false;
		this.callbacks.onRecordingStateChange();

		if (shouldDiscard) {
			this.cleanup();
			return;
		}

		const chunks = this.recordedChunks;
		const recorderMimeType = this.mediaRecorder?.mimeType
			?? VOICE_RECORDING_MIME_CANDIDATES[VOICE_RECORDING_MIME_CANDIDATES.length - 1]
			?? "";
		this.cleanup();
		if (chunks.length === 0) {
			this.callbacks.onNotice(this.t("notice.voiceRecordingEmpty"));
			return;
		}

		await this.callbacks.onResult(new Blob(chunks, { type: recorderMimeType }));
	}

	private cleanup(): void {
		if (this.mediaStream) {
			stopMediaStream(this.mediaStream);
		}
		if (this.audioSourceNode) {
			this.audioSourceNode.disconnect();
		}
		if (this.audioProcessorNode) {
			this.audioProcessorNode.disconnect();
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- Part of ScriptProcessor fallback teardown.
			this.audioProcessorNode.onaudioprocess = null;
		}
		if (this.silentGainNode) {
			this.silentGainNode.disconnect();
		}
		if (this.audioContext) {
			void this.audioContext.close().catch(() => undefined);
		}
		this.mediaRecorder = null;
		this.mediaStream = null;
		this.recordedChunks = [];
		this.audioContext = null;
		this.audioSourceNode = null;
		this.audioProcessorNode = null;
		this.silentGainNode = null;
		this.pcmChunks = [];
		this.pcmSampleRate = VOICE_DEFAULT_SAMPLE_RATE;
		this.recordingMode = null;
		this.discardNextRecording = false;
		this.recording = false;
	}
}

type MicrophonePermissionState = "granted" | "prompt" | "denied" | "unknown";

async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
	const nav = navigator as Navigator & {
		permissions?: {
			query?: (descriptor: { name: string }) => Promise<{ state: string }>;
		};
	};

	if (!nav.permissions || typeof nav.permissions.query !== "function") {
		return "unknown";
	}

	try {
		const result = await nav.permissions.query({ name: "microphone" });
		if (result.state === "granted" || result.state === "prompt" || result.state === "denied") {
			return result.state;
		}
		return "unknown";
	} catch {
		return "unknown";
	}
}

function getMicrophoneErrorMessage(error: unknown, t: Translator): string {
	if (error instanceof DOMException) {
		if (error.name === "NotAllowedError" || error.name === "SecurityError") {
			return t("notice.voicePermissionDenied");
		}
		if (error.name === "NotFoundError") {
			return t("notice.voiceMicrophoneNotFound");
		}
		if (error.name === "NotReadableError" || error.name === "AbortError") {
			return t("notice.voiceMicrophoneBusy");
		}
	}

	return t("notice.voiceFailed");
}

function supportsAudioCapture(): boolean {
	return (
		typeof navigator !== "undefined"
		&& !!navigator.mediaDevices
		&& typeof navigator.mediaDevices.getUserMedia === "function"
		&& (typeof MediaRecorder !== "undefined" || !!getAudioContextCtor())
	);
}

function getPreferredRecordingMimeType(): string {
	if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
		return "";
	}

	for (const candidate of VOICE_RECORDING_MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(candidate)) {
			return candidate;
		}
	}

	return "";
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
	const win = window as unknown as {
		AudioContext?: AudioContextCtor;
		webkitAudioContext?: AudioContextCtor;
	};

	if (typeof win.AudioContext === "function") {
		return win.AudioContext;
	}
	if (typeof win.webkitAudioContext === "function") {
		return win.webkitAudioContext;
	}
	return null;
}

function createWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const pcm16 = new Int16Array(totalLength);
	let offset = 0;

	for (const chunk of chunks) {
		for (let i = 0; i < chunk.length; i += 1) {
			const sample = Math.max(-1, Math.min(1, chunk[i] ?? 0));
			pcm16[offset] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
			offset += 1;
		}
	}

	const wavBytes = new Uint8Array(WAV_HEADER_SIZE + pcm16.byteLength);
	const view = new DataView(wavBytes.buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + pcm16.byteLength, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, WAV_FORMAT_PCM, true);
	view.setUint16(22, PCM_CHANNEL_COUNT, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * PCM_CHANNEL_COUNT * WAV_BYTES_PER_SAMPLE, true);
	view.setUint16(32, PCM_CHANNEL_COUNT * WAV_BYTES_PER_SAMPLE, true);
	view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
	writeAscii(view, 36, "data");
	view.setUint32(40, pcm16.byteLength, true);

	wavBytes.set(new Uint8Array(pcm16.buffer), WAV_HEADER_SIZE);
	return new Blob([wavBytes], { type: VOICE_WAV_MIME_TYPE });
}

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let i = 0; i < value.length; i += 1) {
		view.setUint8(offset + i, value.charCodeAt(i));
	}
}

function stopMediaStream(stream: MediaStream): void {
	for (const track of stream.getTracks()) {
		track.stop();
	}
}
