import { Notice } from "obsidian";
import type { Translator } from "../i18n";
import { ProviderAbortError } from "../providers/IAIProvider";
import type { QuickPromptItem } from "../settings/types";
import { transcribeAudioViaApi } from "../voice/SttApiTranscriber";
import { VoiceRecorder } from "../voice/VoiceRecorder";

const FLOATING_TRACK_INTERVAL_MS = 120;
const FLOATING_MIN_WIDTH = 280;
const FLOATING_MAX_WIDTH = 520;
const FLOATING_MIN_HEIGHT = 190;
const FLOATING_EDGE_PADDING = 8;
const FLOATING_ANCHOR_OFFSET = 10;

export interface FloatingAnchor {
	left: number;
	top: number;
	bottom: number;
}

export interface FloatingBounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface FloatingInputOptions {
	anchor: FloatingAnchor;
	anchorResolver?: () => FloatingAnchor | null;
	boundsResolver?: () => FloatingBounds | null;
	mountEl?: HTMLElement;
	t: Translator;
	voiceInput?: VoiceInputOptions;
	presets?: QuickPromptItem[];
	onSubmit: (instruction: string, signal: AbortSignal) => Promise<void>;
	onClose?: () => void;
}

interface VoiceInputOptions {
	enabled: boolean;
	languageCode: string;
	apiEndpoint: string;
	apiModel: string;
	apiToken: string;
}

export class FloatingInput {
	private readonly containerEl: HTMLDivElement;
	private readonly mountEl: HTMLElement;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly runButtonEl: HTMLButtonElement;
	private readonly cancelButtonEl: HTMLButtonElement;
	private readonly voiceButtonEl: HTMLButtonElement | null;
	private readonly presetButtons = new Map<string, HTMLButtonElement>();
	private readonly presets: QuickPromptItem[];
	private currentAnchor: FloatingAnchor;
	private activePresetId: string | null = null;
	private trackIntervalId: number | null = null;
	private isOpen = false;
	private isSubmitting = false;
	private isTranscribing = false;
	private voiceRecorder: VoiceRecorder | null = null;
	private patchedMountClass = false;
	private activeSubmitAbortController: AbortController | null = null;
	private activeTranscribeAbortController: AbortController | null = null;

	private readonly handlePositionChange = (): void => {
		if (!this.isOpen) {
			return;
		}
		this.position();
	};

	private readonly handleOutsideClick = (event: MouseEvent): void => {
		const target = event.target;
		if (target instanceof Node && this.containerEl.contains(target)) {
			return;
		}
		this.close();
	};

	private readonly handleFocusChange = (event: FocusEvent): void => {
		const target = event.target;
		if (!(target instanceof Node)) {
			return;
		}

		if (this.containerEl.contains(target) || this.mountEl.contains(target)) {
			return;
		}

		this.close();
	};

	private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void this.submit();
		}
	};

	// Registered on document because the textarea is disabled (and unfocused)
	// while a request is running, so its own keydown handler cannot fire.
	private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}

		// Obsidian modals stacked above the floating input keep their own Escape.
		const target = event.target;
		if (target instanceof HTMLElement && target.closest(".modal-container")) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (this.isSubmitting) {
			this.cancelActiveSubmit();
			return;
		}
		if (this.isTranscribing) {
			this.cancelActiveTranscribe();
			return;
		}
		if (this.voiceRecorder?.isRecording) {
			this.voiceRecorder.stop(true);
			return;
		}
		this.close();
	};

	constructor(private readonly options: FloatingInputOptions) {
		const t = options.t;
		this.currentAnchor = options.anchor;
		this.mountEl = options.mountEl ?? document.body;
		this.presets = sanitizePresets(options.presets ?? []);

		this.containerEl = document.createElement("div");
		this.containerEl.className = "ai-refiner-floating-input";
		if (this.mountEl !== document.body) {
			this.containerEl.classList.add("ai-refiner-floating-input--scoped");
		}

		const headerEl = document.createElement("div");
		headerEl.className = "ai-refiner-floating-input__header";

		const titleEl = document.createElement("div");
		titleEl.className = "ai-refiner-floating-input__title";
		titleEl.textContent = t("floating.title");

		const headerMetaEl = document.createElement("div");
		headerMetaEl.className = "ai-refiner-floating-input__meta";

		const hintEl = document.createElement("div");
		hintEl.className = "ai-refiner-floating-input__hint";
		hintEl.textContent = t("floating.hint");
		headerMetaEl.appendChild(hintEl);

		this.voiceButtonEl = options.voiceInput?.enabled
			? this.createVoiceButton(t, options.voiceInput.languageCode)
			: null;
		if (this.voiceButtonEl) {
			this.voiceRecorder = new VoiceRecorder(t, {
				onRecordingStateChange: () => this.syncVoiceUi(),
				onResult: (audio) => this.transcribeRecordedAudio(audio),
				onNotice: (message) => {
					new Notice(message);
				},
			});
			headerMetaEl.appendChild(this.voiceButtonEl);
		}

		headerEl.append(titleEl, headerMetaEl);

		const bodyEl = document.createElement("div");
		bodyEl.className = "ai-refiner-floating-input__body";

		if (this.presets.length > 0) {
			const presetTitleEl = document.createElement("div");
			presetTitleEl.className = "ai-refiner-floating-input__preset-title";
			presetTitleEl.textContent = t("floating.quickPrompts");

			const presetWrapEl = document.createElement("div");
			presetWrapEl.className = "ai-refiner-floating-input__preset-wrap";
			for (const preset of this.presets) {
				const presetButton = document.createElement("button");
				presetButton.type = "button";
				presetButton.className = "ai-refiner-floating-input__preset";
				presetButton.textContent = preset.label;
				presetButton.addEventListener("click", () => {
					this.applyPreset(preset);
				});
				this.presetButtons.set(preset.id, presetButton);
				presetWrapEl.appendChild(presetButton);
			}
			bodyEl.append(presetTitleEl, presetWrapEl);
		}

		this.inputEl = document.createElement("textarea");
		this.inputEl.className = "ai-refiner-floating-input__instruction";
		this.inputEl.placeholder = t("floating.placeholder");
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", this.handleInputKeyDown);

		const actionsEl = document.createElement("div");
		actionsEl.className = "ai-refiner-floating-input__actions";

		this.cancelButtonEl = document.createElement("button");
		this.cancelButtonEl.type = "button";
		this.cancelButtonEl.className = "ai-refiner-floating-input__button ai-refiner-floating-input__button--ghost";
		this.cancelButtonEl.textContent = t("floating.cancel");
		this.cancelButtonEl.addEventListener("click", () => {
			if (this.isSubmitting) {
				this.cancelActiveSubmit();
				return;
			}
			this.close();
		});

		this.runButtonEl = document.createElement("button");
		this.runButtonEl.type = "button";
		this.runButtonEl.className = "ai-refiner-floating-input__button ai-refiner-floating-input__button--primary";
		this.runButtonEl.textContent = t("floating.run");
		this.runButtonEl.addEventListener("click", () => {
			void this.submit();
		});

		actionsEl.append(this.cancelButtonEl, this.runButtonEl);
		bodyEl.append(this.inputEl, actionsEl);
		this.containerEl.append(headerEl, bodyEl);
	}

	open(): void {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.prepareMountElement();
		this.mountEl.appendChild(this.containerEl);
		this.position();
		window.requestAnimationFrame(() => this.position());

		window.addEventListener("resize", this.handlePositionChange);
		window.addEventListener("scroll", this.handlePositionChange, true);
		document.addEventListener("mousedown", this.handleOutsideClick, true);
		document.addEventListener("focusin", this.handleFocusChange, true);
		document.addEventListener("keydown", this.handleGlobalKeyDown, true);

		this.trackIntervalId = window.setInterval(() => this.position(), FLOATING_TRACK_INTERVAL_MS);

		this.inputEl.focus();
		this.inputEl.select();
	}

	close(options: { force?: boolean } = {}): void {
		if (!this.isOpen) {
			return;
		}
		if (this.isSubmitting && !options.force) {
			return;
		}

		if (this.isSubmitting && options.force) {
			this.cancelActiveSubmit();
		}

		// A voice transcription may still be in flight; abort it so its late
		// resolution can't write into a detached textarea or pop a stray Notice.
		this.cancelActiveTranscribe();

		this.isOpen = false;
		window.removeEventListener("resize", this.handlePositionChange);
		window.removeEventListener("scroll", this.handlePositionChange, true);
		document.removeEventListener("mousedown", this.handleOutsideClick, true);
		document.removeEventListener("focusin", this.handleFocusChange, true);
		document.removeEventListener("keydown", this.handleGlobalKeyDown, true);
		if (this.trackIntervalId !== null) {
			window.clearInterval(this.trackIntervalId);
			this.trackIntervalId = null;
		}

		this.voiceRecorder?.dispose();
		this.containerEl.remove();
		this.restoreMountElement();
		this.options.onClose?.();
	}

	forceClose(): void {
		this.close({ force: true });
	}

	isSubmittingRequest(): boolean {
		return this.isSubmitting;
	}

	private async submit(): Promise<void> {
		if (this.isSubmitting) {
			return;
		}

		const instruction = this.inputEl.value.trim();
		if (!instruction) {
			new Notice(this.options.t("notice.enterInstruction"));
			this.inputEl.focus();
			return;
		}

		this.setSubmittingState(true);
		const abortController = new AbortController();
		this.activeSubmitAbortController = abortController;
		let shouldClose = false;
		try {
			await this.options.onSubmit(instruction, abortController.signal);
			if (!abortController.signal.aborted) {
				shouldClose = true;
			}
		} catch (error: unknown) {
			if (!isAbortError(error)) {
				new Notice(getErrorMessage(error, this.options.t));
			}
		} finally {
			if (this.activeSubmitAbortController === abortController) {
				this.activeSubmitAbortController = null;
			}
			if (this.isOpen) {
				this.setSubmittingState(false);
				if (!shouldClose) {
					this.inputEl.focus();
				}
			}
		}

		if (shouldClose) {
			this.close({ force: true });
		}
	}

	private position(): void {
		if (!this.mountEl.isConnected) {
			this.close();
			return;
		}

		const bounds = this.resolveBounds();
		if (!bounds) {
			this.close();
			return;
		}

		const maxWidth = Math.max(FLOATING_MIN_WIDTH, bounds.right - bounds.left - (FLOATING_EDGE_PADDING * 2));
		const maxHeight = Math.max(FLOATING_MIN_HEIGHT, bounds.bottom - bounds.top - (FLOATING_EDGE_PADDING * 2));
		this.containerEl.style.width = `${Math.round(Math.min(FLOATING_MAX_WIDTH, maxWidth))}px`;
		this.containerEl.style.maxHeight = `${Math.round(maxHeight)}px`;

		const anchor = this.resolveAnchor();
		if (!anchor) {
			this.close();
			return;
		}

		const rect = this.containerEl.getBoundingClientRect();
		const panelWidth = rect.width > 0 ? rect.width : FLOATING_MAX_WIDTH;
		const panelHeight = rect.height > 0 ? rect.height : 220;
		const minLeft = bounds.left + FLOATING_EDGE_PADDING;
		const maxLeft = bounds.right - panelWidth - FLOATING_EDGE_PADDING;
		const safeLeft = clamp(anchor.left, minLeft, Math.max(minLeft, maxLeft));

		const minTop = bounds.top + FLOATING_EDGE_PADDING;
		const maxTop = bounds.bottom - panelHeight - FLOATING_EDGE_PADDING;
		let top = anchor.top - panelHeight - FLOATING_ANCHOR_OFFSET;
		if (top < minTop) {
			top = anchor.bottom + FLOATING_ANCHOR_OFFSET;
		}
		top = clamp(top, minTop, Math.max(minTop, maxTop));

		this.containerEl.style.left = `${Math.round(safeLeft)}px`;
		this.containerEl.style.top = `${Math.round(top)}px`;
	}

	private resolveAnchor(): FloatingAnchor {
		const nextAnchor = this.options.anchorResolver?.();
		if (nextAnchor) {
			this.currentAnchor = nextAnchor;
		}
		return this.toMountCoordinates(this.currentAnchor);
	}

	private resolveBounds(): FloatingBounds | null {
		const bounds = this.options.boundsResolver?.();
		if (bounds) {
			return this.toMountCoordinates(bounds);
		}
		if (this.options.boundsResolver) {
			return null;
		}

		const viewportBounds: FloatingBounds = {
			left: window.scrollX,
			right: window.scrollX + window.innerWidth,
			top: window.scrollY,
			bottom: window.scrollY + window.innerHeight,
		};
		return this.toMountCoordinates(viewportBounds);
	}

	private setSubmittingState(value: boolean): void {
		this.isSubmitting = value;
		this.inputEl.disabled = value;
		this.cancelButtonEl.disabled = false;
		this.runButtonEl.disabled = value;
		if (this.voiceButtonEl) {
			this.voiceButtonEl.disabled = value;
		}
		for (const presetButton of this.presetButtons.values()) {
			presetButton.disabled = value;
		}
		if (value) {
			this.voiceRecorder?.stop(true);
		}
		this.runButtonEl.textContent = value ? this.options.t("floating.running") : this.options.t("floating.run");
		this.cancelButtonEl.textContent = value ? this.options.t("floating.cancelRunning") : this.options.t("floating.cancel");
	}

	private cancelActiveSubmit(): void {
		const controller = this.activeSubmitAbortController;
		if (!controller || controller.signal.aborted) {
			return;
		}
		controller.abort();
	}

	private cancelActiveTranscribe(): void {
		const controller = this.activeTranscribeAbortController;
		if (!controller || controller.signal.aborted) {
			return;
		}
		controller.abort();
	}

	private applyPreset(preset: QuickPromptItem): void {
		this.inputEl.value = preset.instruction;
		this.activePresetId = preset.id;
		this.syncPresetUi();
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
	}

	private syncPresetUi(): void {
		for (const [id, element] of this.presetButtons.entries()) {
			element.classList.toggle("is-active", id === this.activePresetId);
		}
	}

	private createVoiceButton(t: Translator, languageCode: string): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "ai-refiner-floating-input__voice";
		button.setAttribute("aria-label", t("floating.voice.start"));
		button.dataset.language = languageCode.trim();
		button.textContent = t("floating.voice.start");
		button.addEventListener("click", () => {
			if (this.isTranscribing) {
				return;
			}
			if (this.voiceRecorder?.isRecording) {
				this.voiceRecorder.stop(false);
			} else {
				this.startVoiceInput();
			}
		});
		return button;
	}

	private startVoiceInput(): void {
		if (this.isSubmitting || this.isTranscribing || !this.voiceRecorder) {
			return;
		}

		const voiceConfig = this.options.voiceInput;
		if (!voiceConfig || !voiceConfig.apiEndpoint.trim() || !voiceConfig.apiModel.trim()) {
			new Notice(this.options.t("notice.voiceApiNotConfigured"));
			return;
		}

		void this.voiceRecorder.start();
	}

	private appendTranscript(transcript: string): void {
		const cleanTranscript = transcript.trim();
		if (!cleanTranscript) {
			return;
		}

		const current = this.inputEl.value;
		if (!current.trim()) {
			this.inputEl.value = cleanTranscript;
		} else {
			const separator = /[\s\n]$/.test(current) ? "" : " ";
			this.inputEl.value = `${current}${separator}${cleanTranscript}`;
		}
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
	}

	private syncVoiceUi(): void {
		if (!this.voiceButtonEl) {
			return;
		}

		const t = this.options.t;
		const isRecording = this.voiceRecorder?.isRecording ?? false;
		const isActive = isRecording || this.isTranscribing;
		this.voiceButtonEl.classList.toggle("is-listening", isRecording);
		this.voiceButtonEl.classList.toggle("is-recording", isRecording);
		this.voiceButtonEl.classList.toggle("is-transcribing", this.isTranscribing);

		if (this.isTranscribing) {
			this.voiceButtonEl.textContent = t("floating.voice.transcribing");
		} else if (isRecording) {
			this.voiceButtonEl.textContent = t("floating.voice.recording");
		} else {
			this.voiceButtonEl.textContent = t("floating.voice.start");
		}

		this.voiceButtonEl.setAttribute(
			"aria-label",
			isActive ? t("floating.voice.stop") : t("floating.voice.start"),
		);
	}

	private async transcribeRecordedAudio(audioBlob: Blob): Promise<void> {
		const voiceConfig = this.options.voiceInput;
		if (!voiceConfig) {
			return;
		}

		this.isTranscribing = true;
		this.syncVoiceUi();
		const abortController = new AbortController();
		this.activeTranscribeAbortController = abortController;
		try {
			const transcript = await transcribeAudioViaApi(audioBlob, {
				endpoint: voiceConfig.apiEndpoint,
				model: voiceConfig.apiModel,
				apiToken: voiceConfig.apiToken,
				languageCode: voiceConfig.languageCode,
			}, abortController.signal);
			if (!abortController.signal.aborted && this.isOpen) {
				this.appendTranscript(transcript);
			}
		} catch (error: unknown) {
			if (!isAbortError(error)) {
				new Notice(getErrorMessage(error, this.options.t));
			}
		} finally {
			if (this.activeTranscribeAbortController === abortController) {
				this.activeTranscribeAbortController = null;
			}
			this.isTranscribing = false;
			if (this.isOpen) {
				this.syncVoiceUi();
			}
		}
	}

	private prepareMountElement(): void {
		if (this.mountEl === document.body) {
			return;
		}

		const computedPosition = window.getComputedStyle(this.mountEl).position;
		if (computedPosition === "static") {
			this.mountEl.classList.add("ai-refiner-floating-mount");
			this.patchedMountClass = true;
		}
	}

	private restoreMountElement(): void {
		if (!this.patchedMountClass) {
			return;
		}

		this.mountEl.classList.remove("ai-refiner-floating-mount");
		this.patchedMountClass = false;
	}

	private toMountCoordinates(bounds: FloatingBounds): FloatingBounds;
	private toMountCoordinates(anchor: FloatingAnchor): FloatingAnchor;
	private toMountCoordinates(value: FloatingBounds | FloatingAnchor): FloatingBounds | FloatingAnchor {
		if (this.mountEl === document.body) {
			return value;
		}

		const mountRect = this.mountEl.getBoundingClientRect();
		const mountLeft = mountRect.left + window.scrollX;
		const mountTop = mountRect.top + window.scrollY;

		if ("right" in value) {
			return {
				left: value.left - mountLeft,
				right: value.right - mountLeft,
				top: value.top - mountTop,
				bottom: value.bottom - mountTop,
			};
		}

		return {
			left: value.left - mountLeft,
			top: value.top - mountTop,
			bottom: value.bottom - mountTop,
		};
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isAbortError(error: unknown): boolean {
	return error instanceof ProviderAbortError
		|| (error instanceof Error && error.name === "AbortError");
}

function getErrorMessage(error: unknown, t: Translator): string {
	return error instanceof Error ? error.message : t("error.refineRequestFailedFallback");
}

function sanitizePresets(presets: QuickPromptItem[]): QuickPromptItem[] {
	const result: QuickPromptItem[] = [];
	const seen = new Set<string>();
	for (const preset of presets) {
		const id = preset.id.trim();
		const label = preset.label.trim();
		const instruction = preset.instruction.trim();
		if (!id || !label || !instruction || seen.has(id)) {
			continue;
		}

		seen.add(id);
		result.push({
			id,
			label,
			instruction,
		});
	}
	return result;
}
