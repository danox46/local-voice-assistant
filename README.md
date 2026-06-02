# Local Voice Assistant

A local push-to-talk voice wrapper that can run in three modes:

- **Codex CLI project mode**: browser speech recognition, Codex CLI in the workspace, and browser text-to-speech. This is the default.
- **Gemini CLI subscription mode**: browser speech recognition, Gemini CLI signed in with your Google account, and browser text-to-speech.
- **OpenAI cloud voice mode**: OpenAI transcription, assistant response, and generated voice audio.

## Published Materials

- Publications page: https://local-voice-assistant-publications.pages.dev/
- Source code and downloads: https://github.com/danox46/local-voice-assistant
- Download ZIP: https://github.com/danox46/local-voice-assistant/archive/refs/heads/main.zip

## Setup

1. Run:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Codex CLI Project Mode

This is the default mode. It sends dictated instructions to `codex exec` in the configured workspace folder.

Install and verify Codex CLI:

```bash
npm install -g @openai/codex
codex doctor
```

The server uses `CODEX_WORKDIR` from `.env`, or defaults to the workspace root two folders above this app.

Codex mode has two submodes:

- **Execute changes**: runs `codex exec` with workspace-write sandboxing.
- **Plan only**: runs `codex exec` with read-only sandboxing and instructs Codex to return a plan without editing files.

While listening, the mic activity meter shows whether sound is reaching the browser. After words are detected, listening auto-stops after a short pause. Use **Stop and send** to finish early, or **Stop instruction** while Codex is thinking to cancel the active local Codex process.

When the browser tab has focus, headset/media playback controls can trigger the app through the browser Media Session API: play starts listening, pause/stop finishes recording or cancels an active instruction. Support depends on the browser and headset driver.

Codex CLI mode uses non-interactive `codex exec`, so full responses do not appear live in the Codex desktop app. The wrapper keeps full response history visible in the page instead.

## Transcription Quality

For Codex and Gemini backends, Settings includes a **Transcription** selector:

- **Browser live speech**: uses the browser's built-in speech recognition. It is fast and shows partial words live. Choose the speech language in Settings for better coding dictation.
- **Gemini audio transcription (experimental)**: records the actual audio and asks Gemini CLI to transcribe it. The Gemini CLI subscription endpoint may reject audio attachments with `INVALID_ARGUMENT`, so this is not the default.
- **OpenAI cloud transcription**: uses OpenAI speech-to-text if `OPENAI_API_KEY` is configured.

## Gemini Subscription Mode

This mode avoids model API-key billing by routing the assistant response through Gemini CLI.

Run this once in the app folder:

```bash
npm run gemini:login
```

Choose **Sign in with Google** and complete the browser login. If your Google AI Pro or Ultra subscription grants Gemini CLI quota, the CLI uses that account path.

## OpenAI Cloud Voice Mode

Copy `.env.example` to `.env`, add `OPENAI_API_KEY`, restart the server, and choose **OpenAI cloud voice mode** in settings.

## How It Works

- Codex mode uses browser speech recognition, `POST /api/text-turn`, Codex CLI, and browser speech synthesis.
- Gemini mode uses browser speech recognition, `POST /api/text-turn`, Gemini CLI, and browser speech synthesis.
- OpenAI mode records audio with `MediaRecorder`, calls `POST /api/voice-turn`, and returns MP3 audio as base64.
- The app speaks only the short summary while keeping the full answer visible.

## Extension Points

The first listener is `push-to-talk`. Wake phrase, always-listen, and Home Assistant integration are reserved behind typed interfaces in `src/server/types.ts` and `src/server/listeners.ts`.
