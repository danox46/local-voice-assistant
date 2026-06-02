import "dotenv/config";
import path from "node:path";
import { z } from "zod";
import type { AssistantSettings } from "../shared/types";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  ASSISTANT_MODEL: z.string().default("gpt-5-mini"),
  TRANSCRIBE_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  TTS_VOICE: z.string().default("marin"),
  SUMMARY_WORDS: z.coerce.number().int().min(15).max(100).default(45),
  CODEX_WORKDIR: z.string().default(path.resolve(process.cwd(), "..", ".."))
});

export const config = envSchema.parse(process.env);

export function hasOpenAiKey() {
  return Boolean(config.OPENAI_API_KEY?.trim());
}

export function defaultSettings(): AssistantSettings {
  return {
    backend: "codex-cli",
    codexMode: "execute",
    transcriptionMode: "browser",
    speechLanguage: "en-US",
    assistantStyle:
      "Warm, concise, practical, and direct. Keep the full answer useful, and keep the spoken summary short enough to hear comfortably.",
    assistantModel: "auto",
    transcribeModel: config.TRANSCRIBE_MODEL,
    ttsModel: config.TTS_MODEL,
    voice: config.TTS_VOICE,
    summaryWords: config.SUMMARY_WORDS
  };
}
