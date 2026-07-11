import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// Obsidian globals for popout-window-aware DOM access.
				activeDocument: "readonly",
				activeWindow: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The lint config itself runs under Node, not inside the plugin bundle.
		files: ["eslint.config.mts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		// Node build/deploy scripts, not part of the plugin bundle.
		"scripts",
		// Dev-only files outside the plugin tsconfig project; validated by vitest/tsc.
		"tests",
		"vitest.config.mts",
	]),
);
