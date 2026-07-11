import { Notice } from "obsidian";
import type { Translator } from "../../i18n";
import { transcribeAudioViaApi } from "../../voice/SttApiTranscriber";
import { VoiceRecorder } from "../../voice/VoiceRecorder";
import { getErrorMessage, isAbortError } from "./errors";
import { panelWindow } from "./dom";

export interface VoiceInputOptions {
	enabled: boolean;
	languageCode: string;
	apiEndpoint: string;
	apiModel: string;
	apiToken: string;
}

export interface VoicePanelHost {
	t: Translator;
	isPanelOpen(): boolean;
	isSubmitting(): boolean;
	appendTranscript(transcript: string): void;
}

// Owns everything voice inside the floating panel: the mic button, the recorder
// lifecycle, and the transcription request (including its cancellation). The host
// panel only supplies open/submitting state and receives the final transcript.
export class VoicePanelIntegration {
	readonly buttonEl: HTMLButtonElement;
	private readonly recorder: VoiceRecorder;
	private transcribing = false;
	private activeTranscribeAbortController: AbortController | null = null;

	constructor(
		private readonly host: VoicePanelHost,
		private readonly config: VoiceInputOptions,
	) {
		this.recorder = new VoiceRecorder(host.t, {
			onRecordingStateChange: () => this.syncUi(),
			onResult: (audio) => this.transcribeRecordedAudio(audio),
			onNotice: (message) => {
				new Notice(message);
			},
		});
		this.buttonEl = this.createButton();
	}

	get isTranscribing(): boolean {
		return this.transcribing;
	}

	// Escape priority inside the panel: cancel a running transcription, then discard
	// an active recording. Returns false when there is nothing voice-related to cancel.
	handleEscape(): boolean {
		if (this.transcribing) {
			this.cancelActiveTranscribe();
			return true;
		}
		if (this.recorder.isRecording) {
			this.recorder.stop(true);
			return true;
		}
		return false;
	}

	setDisabled(value: boolean): void {
		this.buttonEl.disabled = value;
		if (value) {
			this.recorder.stop(true);
		}
	}

	dispose(): void {
		this.cancelActiveTranscribe();
		this.recorder.dispose();
	}

	private createButton(): HTMLButtonElement {
		const t = this.host.t;
		const button = panelWindow().createEl("button");
		button.type = "button";
		button.className = "ai-refiner-floating-input__voice";
		button.setAttribute("aria-label", t("floating.voice.start"));
		button.dataset.language = this.config.languageCode.trim();
		button.textContent = t("floating.voice.start");
		button.addEventListener("click", () => {
			if (this.transcribing) {
				return;
			}
			if (this.recorder.isRecording) {
				this.recorder.stop(false);
			} else {
				this.startVoiceInput();
			}
		});
		return button;
	}

	private startVoiceInput(): void {
		if (this.host.isSubmitting() || this.transcribing) {
			return;
		}

		if (!this.config.apiEndpoint.trim() || !this.config.apiModel.trim()) {
			new Notice(this.host.t("notice.voiceApiNotConfigured"));
			return;
		}

		void this.recorder.start();
	}

	private async transcribeRecordedAudio(audioBlob: Blob): Promise<void> {
		this.transcribing = true;
		this.syncUi();
		const abortController = new AbortController();
		this.activeTranscribeAbortController = abortController;
		try {
			const transcript = await transcribeAudioViaApi(audioBlob, {
				endpoint: this.config.apiEndpoint,
				model: this.config.apiModel,
				apiToken: this.config.apiToken,
				languageCode: this.config.languageCode,
			}, abortController.signal);
			if (!abortController.signal.aborted && this.host.isPanelOpen()) {
				this.host.appendTranscript(transcript);
			}
		} catch (error: unknown) {
			if (!isAbortError(error)) {
				new Notice(getErrorMessage(error, this.host.t));
			}
		} finally {
			if (this.activeTranscribeAbortController === abortController) {
				this.activeTranscribeAbortController = null;
			}
			this.transcribing = false;
			if (this.host.isPanelOpen()) {
				this.syncUi();
			}
		}
	}

	private cancelActiveTranscribe(): void {
		const controller = this.activeTranscribeAbortController;
		if (!controller || controller.signal.aborted) {
			return;
		}
		controller.abort();
	}

	private syncUi(): void {
		const t = this.host.t;
		const isRecording = this.recorder.isRecording;
		const isActive = isRecording || this.transcribing;
		this.buttonEl.classList.toggle("is-listening", isRecording);
		this.buttonEl.classList.toggle("is-recording", isRecording);
		this.buttonEl.classList.toggle("is-transcribing", this.transcribing);

		if (this.transcribing) {
			this.buttonEl.textContent = t("floating.voice.transcribing");
		} else if (isRecording) {
			this.buttonEl.textContent = t("floating.voice.recording");
		} else {
			this.buttonEl.textContent = t("floating.voice.start");
		}

		this.buttonEl.setAttribute(
			"aria-label",
			isActive ? t("floating.voice.stop") : t("floating.voice.start"),
		);
	}
}
