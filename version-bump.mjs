import { readFileSync, writeFileSync } from "node:fs";

// Runs from `npm version <bump>` (see package.json "version" script): npm has already
// bumped package.json, and npm_package_version carries the new version. Syncs
// manifest.json and, when minAppVersion changed, records the mapping in versions.json.

const targetVersion = process.env.npm_package_version;
if (!targetVersion || !/^\d+\.\d+\.\d+$/.test(targetVersion)) {
	console.error(
		`version-bump: expected npm_package_version to be x.y.z, got "${targetVersion ?? ""}". ` +
		"Run this through `npm version patch|minor|major`.",
	);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
if (!minAppVersion) {
	console.error("version-bump: manifest.json has no minAppVersion.");
	process.exit(1);
}
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// versions.json maps plugin version -> minimum required app version so older Obsidian
// installs are served the last compatible release. A new entry is only needed when
// minAppVersion changes; repeating the same mapping for every release adds nothing.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const lastMinAppVersion = Object.values(versions).at(-1);
if (lastMinAppVersion !== minAppVersion) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
	console.log(`version-bump: versions.json += ${targetVersion} -> ${minAppVersion}`);
} else {
	console.log(`version-bump: minAppVersion unchanged (${minAppVersion}); versions.json untouched`);
}
console.log(`version-bump: manifest.json -> ${targetVersion}`);
