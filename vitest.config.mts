import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The `obsidian` package ships types only (no runtime), so unit tests alias it
// to a lightweight stub that provides the handful of values pure modules import.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./tests/stubs/obsidian.ts", import.meta.url)),
		},
	},
});
