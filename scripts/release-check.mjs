import { existsSync, readFileSync } from "node:fs";

// Pre-release gate: run after `npm run build`, before tagging or publishing a release
// (locally via `npm run release-check`, and in CI before assets are attached).
// Exits non-zero with an itemized failure list.

const failures = [];
const check = (ok, message) => {
	if (!ok) {
		failures.push(message);
	}
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");

const semver = /^\d+\.\d+\.\d+$/;

// -- Version consistency ---------------------------------------------------------
check(semver.test(manifest.version ?? ""), `manifest.json version "${manifest.version}" is not x.y.z`);
check(semver.test(pkg.version ?? ""), `package.json version "${pkg.version}" is not x.y.z`);
check(
	manifest.version === pkg.version,
	`version mismatch: manifest.json ${manifest.version} != package.json ${pkg.version}`,
);
if (existsSync("package-lock.json")) {
	const lock = readJson("package-lock.json");
	check(
		lock.version === pkg.version,
		`version mismatch: package-lock.json ${lock.version} != package.json ${pkg.version}`,
	);
}

// -- Manifest required fields ----------------------------------------------------
for (const field of ["id", "name", "version", "minAppVersion", "description", "author"]) {
	check(typeof manifest[field] === "string" && manifest[field].length > 0, `manifest.json missing "${field}"`);
}
check(typeof manifest.isDesktopOnly === "boolean", 'manifest.json missing boolean "isDesktopOnly"');

// -- versions.json covers the current minAppVersion -------------------------------
check(
	Object.values(versions).includes(manifest.minAppVersion),
	`versions.json has no entry mapping to minAppVersion ${manifest.minAppVersion} — run \`npm version\``,
);
for (const [pluginVersion, appVersion] of Object.entries(versions)) {
	check(semver.test(pluginVersion), `versions.json key "${pluginVersion}" is not x.y.z`);
	check(semver.test(appVersion), `versions.json value "${appVersion}" (for ${pluginVersion}) is not x.y.z`);
}

// -- Release artifacts (require a production build) -------------------------------
for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
	check(existsSync(artifact), `release artifact missing: ${artifact} — run \`npm run build\` first`);
}

// -- Tag format (only when running on a tag, e.g. in CI) ---------------------------
// `||` on purpose: an empty env var means "not on a tag", not a tag named "".
const tag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG;
if (tag && semver.test(tag)) {
	check(
		tag === manifest.version,
		`tag ${tag} != manifest.json version ${manifest.version} (Obsidian requires tag == version, no "v" prefix)`,
	);
} else if (tag) {
	check(false, `tag "${tag}" is not bare x.y.z (no "v" prefix allowed)`);
}

if (failures.length > 0) {
	console.error("release-check FAILED:");
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}
console.log(`release-check OK: ${manifest.id} ${manifest.version} (minAppVersion ${manifest.minAppVersion})`);
