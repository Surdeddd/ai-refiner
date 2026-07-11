import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";
import { PluginSecretStore } from "../src/settings/secretStore";
import type { AIRefinerSettings } from "../src/settings/types";

class FakeSecretStorage {
	readonly secrets = new Map<string, string>();
	failWrites = false;

	setSecret(id: string, secret: string): void {
		if (this.failWrites) {
			throw new Error("keychain unavailable");
		}
		this.secrets.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.secrets.get(id) ?? null;
	}
}

function createApp(storage: FakeSecretStorage | null): App {
	return (storage ? { secretStorage: storage } : {}) as unknown as App;
}

function settingsWithTokens(apiToken: string, sttToken: string): AIRefinerSettings {
	return mergeSettings({
		...DEFAULT_SETTINGS,
		customApi: { ...DEFAULT_SETTINGS.customApi, apiToken },
		voiceInput: { ...DEFAULT_SETTINGS.voiceInput, apiToken: sttToken },
	});
}

describe("PluginSecretStore", () => {
	it("reports unavailable without app.secretStorage (older Obsidian)", () => {
		const store = new PluginSecretStore(createApp(null));
		expect(store.isAvailable()).toBe(false);
	});

	it("keeps plaintext persistence when unavailable (no token loss on old apps)", () => {
		const store = new PluginSecretStore(createApp(null));
		const settings = settingsWithTokens("sk-live-token", "stt-token");

		expect(store.hydrateAndMigrate(settings)).toBe(false);
		const persisted = store.prepareForPersistence(settings);
		expect(persisted.customApi.apiToken).toBe("sk-live-token");
		expect(persisted.voiceInput.apiToken).toBe("stt-token");
	});

	it("migrates plaintext tokens into the store exactly once", () => {
		const storage = new FakeSecretStorage();
		const store = new PluginSecretStore(createApp(storage));
		const settings = settingsWithTokens("sk-live-token", "stt-token");

		// Load path: plaintext found -> store it, request a data.json rewrite.
		expect(store.hydrateAndMigrate(settings)).toBe(true);
		expect(storage.secrets.get("ai-refiner-api-token")).toBe("sk-live-token");
		expect(storage.secrets.get("ai-refiner-stt-token")).toBe("stt-token");

		// In-memory settings keep working values for providers/UI.
		expect(settings.customApi.apiToken).toBe("sk-live-token");

		// Save path: persisted copy is blanked.
		const persisted = store.prepareForPersistence(settings);
		expect(persisted.customApi.apiToken).toBe("");
		expect(persisted.voiceInput.apiToken).toBe("");

		// Next load (blank data.json): hydrate from store, no rewrite needed.
		const reloaded = mergeSettings(persisted);
		expect(store.hydrateAndMigrate(reloaded)).toBe(false);
		expect(reloaded.customApi.apiToken).toBe("sk-live-token");
		expect(reloaded.voiceInput.apiToken).toBe("stt-token");
	});

	it("keeps the plaintext copy when the keychain write fails (no token loss)", () => {
		const storage = new FakeSecretStorage();
		storage.failWrites = true;
		const store = new PluginSecretStore(createApp(storage));
		const settings = settingsWithTokens("sk-live-token", "");

		expect(store.hydrateAndMigrate(settings)).toBe(false);
		const persisted = store.prepareForPersistence(settings);
		expect(persisted.customApi.apiToken).toBe("sk-live-token");
	});

	it("does not touch empty tokens", () => {
		const storage = new FakeSecretStorage();
		const store = new PluginSecretStore(createApp(storage));
		const settings = settingsWithTokens("", "");

		expect(store.hydrateAndMigrate(settings)).toBe(false);
		expect(storage.secrets.size).toBe(0);

		const persisted = store.prepareForPersistence(settings);
		expect(persisted.customApi.apiToken).toBe("");
	});

	it("newer plaintext in data.json overwrites a stale stored secret", () => {
		const storage = new FakeSecretStorage();
		storage.secrets.set("ai-refiner-api-token", "old-token");
		const store = new PluginSecretStore(createApp(storage));
		const settings = settingsWithTokens("new-token", "");

		expect(store.hydrateAndMigrate(settings)).toBe(true);
		expect(storage.secrets.get("ai-refiner-api-token")).toBe("new-token");
		expect(settings.customApi.apiToken).toBe("new-token");
	});
});
