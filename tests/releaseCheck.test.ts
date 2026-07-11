import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercises scripts/release-check.mjs as a process against the real repo state
// (versions are expected to be in sync in the working tree).

function runReleaseCheck(env: Record<string, string> = {}): { status: number; output: string } {
	try {
		const output = execFileSync("node", ["scripts/release-check.mjs"], {
			env: { ...process.env, GITHUB_REF_NAME: "", RELEASE_TAG: "", ...env },
			encoding: "utf8",
		});
		return { status: 0, output };
	} catch (error) {
		const failed = error as { status?: number; stdout?: string; stderr?: string };
		return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
	}
}

describe("release-check", () => {
	it("passes for the repo's current synchronized state", () => {
		const result = runReleaseCheck();
		expect(result.output).toContain("release-check OK");
		expect(result.status).toBe(0);
	});

	it("rejects a v-prefixed tag", () => {
		const result = runReleaseCheck({ RELEASE_TAG: "v1.0.1" });
		expect(result.status).not.toBe(0);
		expect(result.output).toContain('no "v" prefix');
	});

	it("rejects a tag that does not match the manifest version", () => {
		const result = runReleaseCheck({ RELEASE_TAG: "9.9.9" });
		expect(result.status).not.toBe(0);
		expect(result.output).toContain("!= manifest.json version");
	});

	it("accepts the tag equal to the manifest version", () => {
		const manifestVersion = process.env.npm_package_version ?? "";
		// Read the real manifest version through the script's own pass criteria.
		const versionFromCheck = runReleaseCheck().output.match(/ (\d+\.\d+\.\d+) /)?.[1] ?? manifestVersion;
		const result = runReleaseCheck({ RELEASE_TAG: versionFromCheck });
		expect(result.status).toBe(0);
	});
});
