import { Notice } from "obsidian";
import type { Translator } from "../i18n";
import type { QuickPromptItem, ResultMode } from "../settings/types";
import { getErrorMessage, isAbortError } from "./floating/errors";
import { panelWindow } from "./floating/dom";
import {
	FLOATING_TRACK_INTERVAL_MS,
	computePanelPlacement,
	getViewportBounds,
	toMountCoordinates,
	type FloatingAnchor,
	type FloatingBounds,
} from "./floating/positioning";
import { ResultPane } from "./floating/ResultPane";
import { VoicePanelIntegration, type VoiceInputOptions } from "./floating/VoicePanelIntegration";

export type { FloatingAnchor, FloatingBounds } from "./floating/positioning";

interface FloatingInputOptions {
	anchor: FloatingAnchor;
	anchorResolver?: () => FloatingAnchor | null;
	boundsResolver?: () => FloatingBounds | null;
	mountEl?: HTMLElement;
	t: Translator;
	voiceInput?: VoiceInputOptions;
	presets?: QuickPromptItem[];
	resultMode: ResultMode;
	// The snapshotted selection, used to render the preview diff.
	originalText: string;
	// Produces the refined text; MUST NOT touch the editor.
	onSubmit: (instruction: string, signal: AbortSignal) => Promise<string>;
	// Writes the refined text into the editor; throws (e.g. selection changed)
	// without closing the panel, so the result is never silently lost.
	onApply: (refinedText: string) => void;
	onClose?: () => void;
}

// Presentation + submit state for the floating prompt. Placement math lives in
// floating/positioning.ts and everything voice in floating/VoicePanelIntegration.ts.
export class FloatingInput {
	private readonly containerEl: HTMLDivElement;
	private readonly mountEl: HTMLElement;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly runButtonEl: HTMLButtonElement;
	private readonly cancelButtonEl: HTMLButtonElement;
	private readonly voice: VoicePanelIntegration | null;
	private readonly resultPane: ResultPane;
	private readonly presetButtons = new Map<string, HTMLButtonElement>();
	private readonly presets: QuickPromptItem[];
	private currentAnchor: FloatingAnchor;
	private activePresetId: string | null = null;
	private trackIntervalId: number | null = null;
	private isOpen = false;
	private isSubmitting = false;
	private patchedMountClass = false;
	private activeSubmitAbortController: AbortController | null = null;
	private pendingResult: string | null = null;

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

	// Registered on activeDocument because the textarea is disabled (and unfocused)
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
		if (this.voice?.handleEscape()) {
			return;
		}
		this.close();
	};

	constructor(private readonly options: FloatingInputOptions) {
		const t = options.t;
		const win = panelWindow();
		this.currentAnchor = options.anchor;
		this.mountEl = options.mountEl ?? activeDocument.body;
		this.presets = sanitizePresets(options.presets ?? []);

		this.containerEl = win.createDiv();
		this.containerEl.className = "ai-refiner-floating-input";
		if (this.mountEl !== activeDocument.body) {
			this.containerEl.classList.add("ai-refiner-floating-input--scoped");
		}

		const headerEl = win.createDiv();
		headerEl.className = "ai-refiner-floating-input__header";

		const titleEl = win.createDiv();
		titleEl.className = "ai-refiner-floating-input__title";
		titleEl.textContent = t("floating.title");

		const headerMetaEl = win.createDiv();
		headerMetaEl.className = "ai-refiner-floating-input__meta";

		const hintEl = win.createDiv();
		hintEl.className = "ai-refiner-floating-input__hint";
		hintEl.textContent = t("floating.hint");
		headerMetaEl.appendChild(hintEl);

		this.voice = options.voiceInput?.enabled
			? new VoicePanelIntegration(
				{
					t,
					isPanelOpen: () => this.isOpen,
					isSubmitting: () => this.isSubmitting,
					appendTranscript: (transcript) => this.appendTranscript(transcript),
				},
				options.voiceInput,
			)
			: null;
		if (this.voice) {
			headerMetaEl.appendChild(this.voice.buttonEl);
		}

		headerEl.append(titleEl, headerMetaEl);

		const bodyEl = win.createDiv();
		bodyEl.className = "ai-refiner-floating-input__body";

		if (this.presets.length > 0) {
			const presetTitleEl = win.createDiv();
			presetTitleEl.className = "ai-refiner-floating-input__preset-title";
			presetTitleEl.textContent = t("floating.quickPrompts");

			const presetWrapEl = win.createDiv();
			presetWrapEl.className = "ai-refiner-floating-input__preset-wrap";
			for (const preset of this.presets) {
				const presetButton = win.createEl("button");
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

		this.inputEl = win.createEl("textarea");
		this.inputEl.className = "ai-refiner-floating-input__instruction";
		this.inputEl.placeholder = t("floating.placeholder");
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", this.handleInputKeyDown);

		const actionsEl = win.createDiv();
		actionsEl.className = "ai-refiner-floating-input__actions";

		this.cancelButtonEl = win.createEl("button");
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

		this.runButtonEl = win.createEl("button");
		this.runButtonEl.type = "button";
		this.runButtonEl.className = "ai-refiner-floating-input__button ai-refiner-floating-input__button--primary";
		this.runButtonEl.textContent = t("floating.run");
		this.runButtonEl.addEventListener("click", () => {
			void this.submit();
		});

		actionsEl.append(this.cancelButtonEl, this.runButtonEl);
		this.resultPane = new ResultPane(t, {
			onApply: () => this.applyPendingResult(),
			onRetry: () => {
				this.resultPane.hide();
				this.pendingResult = null;
				void this.submit();
			},
			onCopy: () => {
				void this.copyPendingResult();
			},
			onDiscard: () => this.close(),
		});
		bodyEl.append(this.inputEl, actionsEl, this.resultPane.containerEl);
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
		activeDocument.addEventListener("mousedown", this.handleOutsideClick, true);
		activeDocument.addEventListener("focusin", this.handleFocusChange, true);
		activeDocument.addEventListener("keydown", this.handleGlobalKeyDown, true);

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

		this.isOpen = false;
		window.removeEventListener("resize", this.handlePositionChange);
		window.removeEventListener("scroll", this.handlePositionChange, true);
		activeDocument.removeEventListener("mousedown", this.handleOutsideClick, true);
		activeDocument.removeEventListener("focusin", this.handleFocusChange, true);
		activeDocument.removeEventListener("keydown", this.handleGlobalKeyDown, true);
		if (this.trackIntervalId !== null) {
			window.clearInterval(this.trackIntervalId);
			this.trackIntervalId = null;
		}

		// Stops recording, aborts an in-flight transcription (so its late resolution
		// can't write into a detached textarea), and releases the microphone.
		this.voice?.dispose();
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
		let refinedText: string | null = null;
		try {
			const result = await this.options.onSubmit(instruction, abortController.signal);
			if (!abortController.signal.aborted) {
				refinedText = result;
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
				if (refinedText === null) {
					this.inputEl.focus();
				}
			}
		}

		if (refinedText === null || !this.isOpen) {
			return;
		}

		if (this.options.resultMode === "replace") {
			this.pendingResult = refinedText;
			this.applyPendingResult();
			return;
		}

		this.showResult(refinedText);
	}

	private showResult(refinedText: string): void {
		this.pendingResult = refinedText;
		this.resultPane.setContent(this.options.originalText, refinedText);
		this.resultPane.show();
		this.position();
	}

	// Apply may fail (the document changed while previewing); the panel stays open
	// so the result can still be copied instead of being lost.
	private applyPendingResult(): void {
		const refinedText = this.pendingResult;
		if (refinedText === null) {
			return;
		}

		try {
			this.options.onApply(refinedText);
		} catch (error: unknown) {
			new Notice(getErrorMessage(error, this.options.t));
			return;
		}
		this.close({ force: true });
	}

	private async copyPendingResult(): Promise<void> {
		if (this.pendingResult === null) {
			return;
		}

		try {
			await navigator.clipboard.writeText(this.pendingResult);
			new Notice(this.options.t("notice.copiedToClipboard"));
		} catch {
			new Notice(this.options.t("error.refineRequestFailedFallback"));
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

		const anchor = this.resolveAnchor();
		const rect = this.containerEl.getBoundingClientRect();
		const placement = computePanelPlacement(anchor, bounds, { width: rect.width, height: rect.height });

		this.containerEl.style.width = `${placement.width}px`;
		this.containerEl.style.maxHeight = `${placement.maxHeight}px`;
		this.containerEl.style.left = `${placement.left}px`;
		this.containerEl.style.top = `${placement.top}px`;
	}

	private resolveAnchor(): FloatingAnchor {
		const nextAnchor = this.options.anchorResolver?.();
		if (nextAnchor) {
			this.currentAnchor = nextAnchor;
		}
		return toMountCoordinates(this.mountEl, this.currentAnchor);
	}

	private resolveBounds(): FloatingBounds | null {
		const bounds = this.options.boundsResolver?.();
		if (bounds) {
			return toMountCoordinates(this.mountEl, bounds);
		}
		if (this.options.boundsResolver) {
			return null;
		}

		return toMountCoordinates(this.mountEl, getViewportBounds());
	}

	private setSubmittingState(value: boolean): void {
		this.isSubmitting = value;
		this.inputEl.disabled = value;
		this.cancelButtonEl.disabled = false;
		this.runButtonEl.disabled = value;
		this.voice?.setDisabled(value);
		this.resultPane.setDisabled(value);
		for (const presetButton of this.presetButtons.values()) {
			presetButton.disabled = value;
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

	private prepareMountElement(): void {
		if (this.mountEl === activeDocument.body) {
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
