import { type Editor, Plugin } from "obsidian";
import type { Translator } from "../i18n";
import { type TriggerSource, RefineSelectionService } from "../services/RefineSelectionService";

export function registerCommands(
	plugin: Plugin,
	refineSelectionService: RefineSelectionService,
	translator: Translator,
): void {
	plugin.addCommand({
		id: "refine-selection",
		name: translator("command.aiRefineSelection"),
		editorCallback: async (editor: Editor) => {
			const triggerSource: TriggerSource = "command";
			await refineSelectionService.run(editor, triggerSource);
		},
	});
}
