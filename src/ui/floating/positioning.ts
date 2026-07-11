export const FLOATING_TRACK_INTERVAL_MS = 120;
export const FLOATING_MIN_WIDTH = 280;
export const FLOATING_MAX_WIDTH = 520;
export const FLOATING_MIN_HEIGHT = 190;
export const FLOATING_EDGE_PADDING = 8;
export const FLOATING_ANCHOR_OFFSET = 10;

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

export interface PanelPlacement {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
}

// Pure placement math: prefers sitting above the anchor, flips below when there is
// no room, and clamps into the bounds with edge padding on every side.
export function computePanelPlacement(
	anchor: FloatingAnchor,
	bounds: FloatingBounds,
	panelSize: { width: number; height: number },
): PanelPlacement {
	const maxWidth = Math.max(FLOATING_MIN_WIDTH, bounds.right - bounds.left - (FLOATING_EDGE_PADDING * 2));
	const maxHeight = Math.max(FLOATING_MIN_HEIGHT, bounds.bottom - bounds.top - (FLOATING_EDGE_PADDING * 2));
	const width = Math.round(Math.min(FLOATING_MAX_WIDTH, maxWidth));

	const panelWidth = panelSize.width > 0 ? panelSize.width : FLOATING_MAX_WIDTH;
	const panelHeight = panelSize.height > 0 ? panelSize.height : 220;

	const minLeft = bounds.left + FLOATING_EDGE_PADDING;
	const maxLeft = bounds.right - panelWidth - FLOATING_EDGE_PADDING;
	const left = clamp(anchor.left, minLeft, Math.max(minLeft, maxLeft));

	const minTop = bounds.top + FLOATING_EDGE_PADDING;
	const maxTop = bounds.bottom - panelHeight - FLOATING_EDGE_PADDING;
	let top = anchor.top - panelHeight - FLOATING_ANCHOR_OFFSET;
	if (top < minTop) {
		top = anchor.bottom + FLOATING_ANCHOR_OFFSET;
	}
	top = clamp(top, minTop, Math.max(minTop, maxTop));

	return {
		left: Math.round(left),
		top: Math.round(top),
		width,
		maxHeight: Math.round(maxHeight),
	};
}

export function toMountCoordinates(mountEl: HTMLElement, bounds: FloatingBounds): FloatingBounds;
export function toMountCoordinates(mountEl: HTMLElement, anchor: FloatingAnchor): FloatingAnchor;
export function toMountCoordinates(
	mountEl: HTMLElement,
	value: FloatingBounds | FloatingAnchor,
): FloatingBounds | FloatingAnchor {
	if (mountEl === activeDocument.body) {
		return value;
	}

	const mountRect = mountEl.getBoundingClientRect();
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

export function getViewportBounds(): FloatingBounds {
	return {
		left: window.scrollX,
		right: window.scrollX + window.innerWidth,
		top: window.scrollY,
		bottom: window.scrollY + window.innerHeight,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
