// Obsidian attaches the createEl/createDiv helpers to every window (main and
// popouts), but the published typings declare them only as main-window globals.
// This view exposes them on activeWindow so panel DOM nodes are created in the
// window that actually hosts the panel.
type ObsidianWindowHelpers = {
	createEl: typeof createEl;
	createDiv: typeof createDiv;
	createSpan: typeof createSpan;
};

export function panelWindow(): ObsidianWindowHelpers {
	return activeWindow as unknown as ObsidianWindowHelpers;
}
