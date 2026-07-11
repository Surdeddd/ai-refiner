import type { Translator } from "../../i18n";
import { diffWords } from "../../utils/diff";
import { panelWindow } from "./dom";

export interface ResultPaneHandlers {
	onApply(): void;
	onRetry(): void;
	onCopy(): void;
	onDiscard(): void;
}

// View-only pane for the preview result mode: renders the refined text as an inline
// word diff against the original selection, with Apply / Retry / Copy / Discard.
// All behavior lives in the host (FloatingInput) via handlers.
export class ResultPane {
	readonly containerEl: HTMLDivElement;
	private readonly textEl: HTMLDivElement;
	private readonly buttons: HTMLButtonElement[] = [];

	constructor(t: Translator, handlers: ResultPaneHandlers) {
		const win = panelWindow();
		this.containerEl = win.createDiv();
		this.containerEl.className = "ai-refiner-floating-input__result";
		this.containerEl.classList.add("is-hidden");

		const titleEl = win.createDiv();
		titleEl.className = "ai-refiner-floating-input__result-title";
		titleEl.textContent = t("floating.result.title");

		this.textEl = win.createDiv();
		this.textEl.className = "ai-refiner-floating-input__result-text";

		const actionsEl = win.createDiv();
		actionsEl.className = "ai-refiner-floating-input__actions";

		const addButton = (label: string, className: string, onClick: () => void): void => {
			const button = win.createEl("button");
			button.type = "button";
			button.className = `ai-refiner-floating-input__button ${className}`;
			button.textContent = label;
			button.addEventListener("click", onClick);
			this.buttons.push(button);
			actionsEl.appendChild(button);
		};

		addButton(t("floating.result.discard"), "ai-refiner-floating-input__button--ghost", () => handlers.onDiscard());
		addButton(t("floating.result.copy"), "ai-refiner-floating-input__button--ghost", () => handlers.onCopy());
		addButton(t("floating.result.retry"), "ai-refiner-floating-input__button--ghost", () => handlers.onRetry());
		addButton(t("floating.result.apply"), "ai-refiner-floating-input__button--primary", () => handlers.onApply());

		this.containerEl.append(titleEl, this.textEl, actionsEl);
	}

	// Incremental text while a response streams in; replaced by the final diff
	// render (setContent) once the request settles.
	setStreamingText(text: string): void {
		this.textEl.setText(text);
	}

	setContent(originalText: string, refinedText: string): void {
		this.textEl.empty();
		const segments = diffWords(originalText, refinedText);
		if (!segments) {
			// Over the diff budget: show the plain refined text.
			this.textEl.setText(refinedText);
			return;
		}

		const win = panelWindow();
		for (const segment of segments) {
			const spanEl = win.createSpan();
			spanEl.className = `ai-refiner-diff--${segment.type}`;
			spanEl.textContent = segment.text;
			this.textEl.appendChild(spanEl);
		}
	}

	show(): void {
		this.containerEl.classList.remove("is-hidden");
	}

	hide(): void {
		this.containerEl.classList.add("is-hidden");
	}

	setDisabled(value: boolean): void {
		for (const button of this.buttons) {
			button.disabled = value;
		}
	}
}
