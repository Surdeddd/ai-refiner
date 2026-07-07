// Copies the built plugin artifacts into an Obsidian vault for local testing.
// Set OBSIDIAN_PLUGIN_DIR to the target plugin folder, e.g.
//   OBSIDIAN_PLUGIN_DIR="$HOME/Obsidian/.obsidian/plugins/ai-refiner" npm run deploy
import { copyFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const target = process.env.OBSIDIAN_PLUGIN_DIR;
if (!target) {
	console.error(
		"OBSIDIAN_PLUGIN_DIR is not set.\n" +
		"Point it at your vault's plugin folder, for example:\n" +
		'  OBSIDIAN_PLUGIN_DIR="$HOME/Obsidian/.obsidian/plugins/ai-refiner" npm run deploy',
	);
	process.exit(1);
}

for (const name of ARTIFACTS) {
	const source = join(root, name);
	try {
		await access(source);
	} catch {
		console.error(`Missing ${name}. Run \`npm run build\` first.`);
		process.exit(1);
	}
}

await mkdir(target, { recursive: true });
for (const name of ARTIFACTS) {
	await copyFile(join(root, name), join(target, name));
}
console.log(`Deployed ${ARTIFACTS.join(", ")} to ${target}`);
