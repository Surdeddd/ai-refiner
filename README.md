# AI Refiner

An Obsidian plugin that refines selected text in place through a floating prompt.
Select text, describe how you want it changed, and the result replaces your selection.

It works with cloud APIs, local models, and AI CLIs — you choose the backend, and
nothing leaves your machine unless you configure it to.

## Features

- **Floating prompt** anchored to your cursor — type an instruction, press Enter, done.
- **Quick prompt presets** — one-click Fix grammar, Make clearer, Shorten, Formal tone,
  Translate — fully editable, and you can add your own.
- **Multiple backends** through one pipeline (see the table below).
- **Three ways to trigger**: command palette, ribbon icon, or a custom hotkey.
- **Optional voice input** — dictate your instruction via a Whisper-compatible
  transcription endpoint (off by default).
- **In-flight cancel** — press Escape to abort a running request.
- **Safe replacement** — if the document changes while a request runs, the stale result
  is discarded instead of overwriting unrelated text.
- **Localized** UI (English, Russian, Spanish) that follows your Obsidian language.

## Providers

| Provider | Type | Platform | Notes |
| --- | --- | --- | --- |
| Custom API | Cloud / self-hosted | Desktop + mobile | OpenAI-compatible, Anthropic, Google Gemini, OpenRouter, Groq, and similar — detected from the endpoint URL. |
| Local models | Local | Desktop + mobile | Ollama and OpenAI-compatible local servers (LM Studio, etc.). |
| Gemini CLI | Local CLI | Desktop only | Runs the Gemini CLI as a child process. |
| Codex CLI | Local CLI | Desktop only | Runs the Codex CLI as a child process. |

On mobile, CLI providers are hidden and the plugin falls back to an API/local provider
automatically.

## Installation

### Manual (from a release)

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into your vault at `<Vault>/.obsidian/plugins/ai-refiner/`.
3. Reload Obsidian and enable **AI Refiner** under **Settings → Community plugins**.

### Build from source

```bash
npm install
npm run build
```

Then copy the produced `main.js`, `manifest.json`, and `styles.css` into the plugin
folder as above, or use the deploy helper:

```bash
OBSIDIAN_PLUGIN_DIR="$HOME/Obsidian/.obsidian/plugins/ai-refiner" npm run deploy
```

## Usage

1. Select some text in a note.
2. Trigger AI Refiner via the command palette (**AI refine selection**), the ribbon
   icon, or your configured hotkey.
3. Type an instruction (or pick a quick prompt) and press Enter.
4. The refined text replaces your selection. Press Escape any time to cancel.

## Settings

- **Provider** — the backend used for refinement.
- **Base instruction** — optional text prepended to every request.
- **Shortcut** — capture and enable a custom hotkey.
- **Voice input** — enable the microphone button and set the transcription endpoint.
- **Quick prompts** — edit the built-in presets or add custom ones.
- **Provider-specific fields**:
  - CLI: executable path, arguments (JSON array), timeout.
  - API / local: endpoint, model (auto-detectable), token (if required).

## Network use and privacy

This plugin makes network requests only to endpoints **you** configure. Nothing is sent
anywhere by default, and there is no telemetry or analytics of any kind.

What is sent, and where:

- **API / local providers** — your selected text and the instruction go to the endpoint
  URL you set. If the endpoint needs a key, it is sent as a request header
  (`Authorization: Bearer …`, `x-api-key`, or `x-goog-api-key`).
- **CLI providers** (desktop only) — your text and instruction are written to the CLI
  process over stdin. Whatever that tool does with it (including its own network calls)
  is governed by that tool, not this plugin.
- **Voice input** (optional) — recorded audio is sent to the transcription endpoint you
  configure.
- **Model discovery** (optional) — pressing "detect models" queries the provider's models
  endpoint.

**Token storage:** API tokens are saved unencrypted in the plugin's `data.json`. A synced
or backed-up vault propagates them, so do not share that file.

## Mobile

The plugin runs on mobile. CLI providers require Node/Electron APIs and are therefore
desktop-only; on mobile, use an API or local-model provider.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
npm run lint    # eslint (incl. obsidianmd rules)
npm test        # vitest unit tests for pure logic
```

Source lives in `src/`, split by responsibility: `providers/` (backend strategies),
`services/` (refine flow), `ui/` (floating input), `settings/`, `voice/`, `i18n/`, and
`utils/`. Unit tests for the pure logic live in `tests/`.

## Releasing

Releases are automated by `.github/workflows/release.yml`. Bump the version (this updates
`manifest.json` and `versions.json`), then push a tag **equal to the manifest version**
(no `v` prefix):

```bash
npm version patch   # or minor / major
git push && git push --tags
```

The workflow lints, tests, builds, and attaches `main.js`, `manifest.json`, and
`styles.css` to a GitHub release.

## License

Released under the 0BSD license. See [LICENSE](LICENSE).
