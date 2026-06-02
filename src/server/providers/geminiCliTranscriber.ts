import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AssistantSettings } from "../../shared/types";
import type { AudioInput, Transcriber } from "../types";

const execFileAsync = promisify(execFile);

function geminiScriptPath() {
  return path.join(process.cwd(), "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
}

function stripTranscript(text: string) {
  return text
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^transcript:\s*/i, "")
    .trim();
}

export class GeminiCliTranscriber implements Transcriber {
  async transcribe(audio: AudioInput, settings: AssistantSettings) {
    if (!audio.path) {
      throw new Error("Gemini audio transcription needs a saved audio file path.");
    }

    const audioPath = audio.path.replaceAll("\\", "/");
    const prompt = [
      "Transcribe the attached audio as accurately as possible.",
      "Return only the words spoken by the user.",
      "Preserve project names, filenames, commands, and programming terms when you can.",
      "If the audio is empty or unintelligible, return an empty response.",
      `Audio: @{${audioPath}}`
    ].join("\n");

    try {
      const args = [geminiScriptPath(), "--prompt", prompt, "--skip-trust", "--approval-mode", "plan"];
      if (settings.transcribeModel && settings.transcribeModel.toLowerCase().startsWith("gemini")) {
        args.push("--model", settings.transcribeModel);
      }

      const { stdout } = await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true
      });

      return stripTranscript(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini CLI transcription failed.";
      if (message.includes("Auth method") || message.includes("GEMINI_API_KEY")) {
        throw new Error(
          "Gemini CLI is installed but not signed in. Run `npm run gemini:login` in this app folder, choose Sign in with Google, then restart the server."
        );
      }
      if (message.includes("INVALID_ARGUMENT") || message.includes("invalid argument")) {
        throw new Error(
          "Gemini CLI rejected the uploaded audio file. Switch transcription to Browser live speech, or use OpenAI cloud transcription if you add an API key."
        );
      }
      throw error;
    }
  }
}
