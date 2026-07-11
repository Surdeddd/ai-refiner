import { requireApiVersion, type App } from "obsidian";
import type { AIRefinerSettings } from "./types";

// SecretStorage ids are a vault-wide, user-visible collection (Settings -> Keychain);
// lowercase alphanumeric with dashes is the required format.
const API_TOKEN_SECRET_ID = "ai-refiner-api-token";
const STT_TOKEN_SECRET_ID = "ai-refiner-stt-token";

// Minimal shape of app.secretStorage (added in Obsidian 1.11.4). Reached through a
// cast on purpose: our minAppVersion stays below 1.11.4, and the review bot's
// no-unsupported-api rule flags direct `app.secretStorage` access regardless of the
// requireApiVersion() runtime gate living in isAvailable().
interface SecretStorageLike {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
}

// Bridges plugin settings and Obsidian's SecretStorage (app 1.11.4+):
// - in-memory settings ALWAYS carry the real token values, so providers/UI are
//   storage-agnostic;
// - on save, token values are stripped from the persisted data.json when the
//   secret store is available;
// - on load, tokens are hydrated back from the store, and any plaintext still in
//   data.json is migrated in (write-verified before the plaintext copy is dropped).
// On older Obsidian versions everything behaves exactly as before (plaintext in
// data.json). Secrets are per-device and never sync — a vault synced to a new
// device needs the token re-entered there once.
export class PluginSecretStore {
	constructor(private readonly app: App) {}

	isAvailable(): boolean {
		if (!requireApiVersion("1.11.4")) {
			return false;
		}
		const storage = this.getStorage();
		return !!storage
			&& typeof storage.getSecret === "function"
			&& typeof storage.setSecret === "function";
	}

	// Fills in-memory settings with secret values and migrates plaintext tokens out
	// of data.json. Returns true when data.json still holds plaintext that was
	// successfully stored and should now be rewritten without it.
	hydrateAndMigrate(settings: AIRefinerSettings): boolean {
		const storage = this.isAvailable() ? this.getStorage() : null;
		if (!storage) {
			return false;
		}

		const apiMigrated = hydrateToken(storage, settings.customApi, "apiToken", API_TOKEN_SECRET_ID);
		const sttMigrated = hydrateToken(storage, settings.voiceInput, "apiToken", STT_TOKEN_SECRET_ID);
		return apiMigrated || sttMigrated;
	}

	// Returns the object to persist: tokens are written to the secret store and
	// blanked in data.json. If the store is unavailable (or a write fails), the
	// token is kept in data.json — losing it would be worse than plaintext.
	prepareForPersistence(settings: AIRefinerSettings): AIRefinerSettings {
		const storage = this.isAvailable() ? this.getStorage() : null;
		if (!storage) {
			return settings;
		}

		return {
			...settings,
			customApi: {
				...settings.customApi,
				apiToken: storeToken(storage, settings.customApi.apiToken, API_TOKEN_SECRET_ID),
			},
			voiceInput: {
				...settings.voiceInput,
				apiToken: storeToken(storage, settings.voiceInput.apiToken, STT_TOKEN_SECRET_ID),
			},
		};
	}

	private getStorage(): SecretStorageLike | null {
		const storage = (this.app as unknown as { secretStorage?: SecretStorageLike }).secretStorage;
		return storage ?? null;
	}
}

// Persist path: returns the value to write into data.json ("" once the secret is
// safely in the store, the original token otherwise).
function storeToken(storage: SecretStorageLike, token: string, secretId: string): string {
	const trimmed = token.trim();
	if (!trimmed) {
		return "";
	}

	try {
		storage.setSecret(secretId, trimmed);
		if (storage.getSecret(secretId) === trimmed) {
			return "";
		}
	} catch {
		// fall through to keeping the plaintext copy
	}
	return token;
}

// Load path: plaintext in data.json wins (it is the user's most recent input) and is
// migrated into the store; otherwise the in-memory value is hydrated from the store.
// Returns true when a verified migration happened and data.json should be rewritten.
function hydrateToken<K extends string>(
	storage: SecretStorageLike,
	container: Record<K, string>,
	key: K,
	secretId: string,
): boolean {
	const plaintext = container[key].trim();
	if (plaintext) {
		try {
			storage.setSecret(secretId, plaintext);
			return storage.getSecret(secretId) === plaintext;
		} catch {
			return false;
		}
	}

	try {
		container[key] = storage.getSecret(secretId) ?? "";
	} catch {
		// leave the empty value; the user can re-enter the token
	}
	return false;
}
