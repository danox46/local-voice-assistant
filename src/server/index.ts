import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { AssistantSettings, ConversationMessage } from "../shared/types";
import { config, defaultSettings, hasOpenAiKey } from "./config";
import { createOpenAIClient } from "./openaiClient";
import {
  cancelActiveCodexRun,
  CodexCliAssistantResponder
} from "./providers/codexCliAssistantResponder";
import { GeminiCliAssistantResponder } from "./providers/geminiCliAssistantResponder";
import { GeminiCliTranscriber } from "./providers/geminiCliTranscriber";
import { OpenAIAssistantResponder } from "./providers/openaiAssistantResponder";
import { OpenAISpeechSynthesizer } from "./providers/openaiSpeechSynthesizer";
import { OpenAITranscriber } from "./providers/openaiTranscriber";
import { handleTextTurn } from "./textTurn";
import { handleVoiceTurn } from "./voiceTurn";
import { futureListenerModes, integrationBoundaries, pushToTalkListener } from "./listeners";
import fs from "node:fs";
import path from "node:path";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string()
});

const settingsSchema = z.object({
  backend: z.enum(["codex-cli", "gemini-cli", "openai"]),
  codexMode: z.enum(["execute", "plan"]).default("execute"),
  transcriptionMode: z
    .enum(["gemini-cli-audio", "browser", "openai-cloud"])
    .default("browser"),
  speechLanguage: z.string().min(2).default("en-US"),
  assistantStyle: z.string().min(1),
  assistantModel: z.string().min(1),
  transcribeModel: z.string().min(1),
  ttsModel: z.string().min(1),
  voice: z.string().min(1),
  summaryWords: z.coerce.number().int().min(15).max(100)
});

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return JSON.parse(value) as T;
}

function apiError(code: string, message: string, status = 400) {
  return { status, body: { error: { code, message } } };
}

function logServerError(context: string, error: unknown) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[${new Date().toISOString()}] ${context}\n${message}`);
}

function hasGeminiCli() {
  return fs.existsSync(
    path.join(process.cwd(), "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
  );
}

function hasCodexCli() {
  const candidates =
    process.platform === "win32"
      ? (process.env.PATH ?? "")
          .split(path.delimiter)
          .flatMap((entry) => [path.join(entry, "codex.cmd"), path.join(entry, "codex.exe")])
      : (process.env.PATH ?? "").split(path.delimiter).map((entry) => path.join(entry, "codex"));
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function openAiAssistantModel() {
  return config.ASSISTANT_MODEL === "auto" ? "gpt-5-mini" : config.ASSISTANT_MODEL;
}

function createAssistant(settings: AssistantSettings) {
  return settings.backend === "codex-cli"
    ? new CodexCliAssistantResponder()
    : settings.backend === "gemini-cli"
      ? new GeminiCliAssistantResponder()
      : new OpenAIAssistantResponder(createOpenAIClient());
}

function normalizeSettings(settings: AssistantSettings) {
  return settings.backend === "openai" && settings.assistantModel === "auto"
    ? { ...settings, assistantModel: openAiAssistantModel() }
    : settings;
}

async function withSavedAudioFile<T>(
  file: Express.Multer.File,
  callback: (input: { path: string; filename: string; mimeType: string; buffer: Buffer }) => Promise<T>
) {
  const audioDir = path.join(process.cwd(), "work", "audio");
  await fs.promises.mkdir(audioDir, { recursive: true });
  const extension = path.extname(file.originalname) || ".webm";
  const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  const audioPath = path.join(audioDir, filename);
  await fs.promises.writeFile(audioPath, file.buffer);
  try {
    return await callback({
      path: audioPath,
      filename,
      mimeType: file.mimetype || "audio/webm",
      buffer: file.buffer
    });
  } finally {
    await fs.promises.unlink(audioPath).catch(() => undefined);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasOpenAiKey: hasOpenAiKey(),
    hasGeminiCli: hasGeminiCli(),
    hasCodexCli: hasCodexCli(),
    codexWorkdir: config.CODEX_WORKDIR,
    settings: defaultSettings(),
    listenerModes: [pushToTalkListener, ...futureListenerModes],
    activeListenerMode: pushToTalkListener.id,
    integrations: integrationBoundaries
  });
});

app.post("/api/text-turn", async (req, res) => {
  try {
    const bodySchema = z.object({
      transcript: z.string(),
      history: z.array(messageSchema).max(24).default([]),
      settings: settingsSchema
    });
    const body = bodySchema.parse(req.body);

    if (body.settings.backend === "openai" && !hasOpenAiKey()) {
      const error = apiError(
        "missing_openai_api_key",
        "OpenAI mode needs OPENAI_API_KEY. Switch to Gemini CLI mode or add the key.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    if (body.settings.backend === "codex-cli" && !hasCodexCli()) {
      const error = apiError(
        "missing_codex_cli",
        "Codex CLI is not available on PATH. Install it with `npm install -g @openai/codex`, then restart the server.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    const settings = normalizeSettings(body.settings);
    const assistant = createAssistant(settings);
    console.log(
      `[${new Date().toISOString()}] text-turn backend=${settings.backend} codexMode=${settings.codexMode}`
    );

    const result = await handleTextTurn(body.transcript, body.history, settings, assistant);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    logServerError("text-turn failed", error);
    res.status(500).json({
      error: {
        code: "text_turn_failed",
        message
      }
    });
  }
});

app.post("/api/cancel-turn", (_req, res) => {
  const cancelled = cancelActiveCodexRun();
  res.json({ cancelled });
});

app.post("/api/audio-text-turn", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      const error = apiError("missing_audio", "No audio recording was uploaded.");
      res.status(error.status).json(error.body);
      return;
    }

    const parsedHistory = z
      .array(messageSchema)
      .max(24)
      .parse(parseJsonField(req.body.history, [])) as ConversationMessage[];
    const settings = normalizeSettings(
      settingsSchema.parse({
        ...defaultSettings(),
        ...parseJsonField<Partial<AssistantSettings>>(req.body.settings, {})
      })
    );
    console.log(
      `[${new Date().toISOString()}] audio-text-turn backend=${settings.backend} transcription=${settings.transcriptionMode} bytes=${req.file.size} mime=${req.file.mimetype || "unknown"}`
    );

    if (settings.backend === "codex-cli" && !hasCodexCli()) {
      const error = apiError(
        "missing_codex_cli",
        "Codex CLI is not available on PATH. Install it with `npm install -g @openai/codex`, then restart the server.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    if (settings.backend === "gemini-cli" && !hasGeminiCli()) {
      const error = apiError(
        "missing_gemini_cli",
        "Gemini CLI is not installed in this app folder. Run `npm install`, then `npm run gemini:login`.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    if (settings.transcriptionMode === "openai-cloud" && !hasOpenAiKey()) {
      const error = apiError(
        "missing_openai_api_key",
        "OpenAI transcription needs OPENAI_API_KEY. Switch transcription to Gemini audio or add the key.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    const client = settings.transcriptionMode === "openai-cloud" ? createOpenAIClient() : null;
    const transcriber =
      settings.transcriptionMode === "openai-cloud"
        ? new OpenAITranscriber(client!)
        : new GeminiCliTranscriber();

    const result = await withSavedAudioFile(req.file, async (audio) => {
      console.log(`[${new Date().toISOString()}] transcribing audio via ${settings.transcriptionMode}`);
      const transcript = await transcriber.transcribe(audio, settings);
      console.log(
        `[${new Date().toISOString()}] transcript chars=${transcript.length}; sending to ${settings.backend}`
      );
      return handleTextTurn(transcript, parsedHistory, settings, createAssistant(settings));
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    logServerError("audio-text-turn failed", error);
    res.status(500).json({
      error: {
        code: "audio_text_turn_failed",
        message
      }
    });
  }
});

app.post("/api/voice-turn", upload.single("audio"), async (req, res) => {
  try {
    if (!hasOpenAiKey()) {
      const error = apiError(
        "missing_openai_api_key",
        "Add OPENAI_API_KEY to your .env file, then restart the server.",
        503
      );
      res.status(error.status).json(error.body);
      return;
    }

    if (!req.file) {
      const error = apiError("missing_audio", "No audio recording was uploaded.");
      res.status(error.status).json(error.body);
      return;
    }

    const parsedHistory = z
      .array(messageSchema)
      .max(24)
      .parse(parseJsonField(req.body.history, [])) as ConversationMessage[];
    const settings = settingsSchema.parse({
      ...defaultSettings(),
      ...parseJsonField<Partial<AssistantSettings>>(req.body.settings, {})
    });
    const openAiSettings =
      settings.assistantModel === "auto"
        ? { ...settings, assistantModel: openAiAssistantModel() }
        : settings;

    const client = createOpenAIClient();
    console.log(
      `[${new Date().toISOString()}] voice-turn backend=openai bytes=${req.file.size} mime=${req.file.mimetype || "unknown"}`
    );
    const result = await handleVoiceTurn(
      {
        buffer: req.file.buffer,
        filename: req.file.originalname || "recording.webm",
        mimeType: req.file.mimetype || "audio/webm"
      },
      parsedHistory,
      openAiSettings,
      {
        transcriber: new OpenAITranscriber(client),
        assistant: new OpenAIAssistantResponder(client),
        speech: new OpenAISpeechSynthesizer(client)
      }
    );

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    logServerError("voice-turn failed", error);
    res.status(500).json({
      error: {
        code: "voice_turn_failed",
        message
      }
    });
  }
});

app.listen(config.PORT, () => {
  console.log(`Voice assistant API listening on http://127.0.0.1:${config.PORT}`);
});
