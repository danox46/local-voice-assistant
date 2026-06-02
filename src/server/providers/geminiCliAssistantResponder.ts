import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ConversationMessage } from "../../shared/types";
import type { AssistantResponder } from "../types";

const execFileAsync = promisify(execFile);

function formatHistory(history: ConversationMessage[]) {
  return history
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function parseJsonResponse(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini CLI did not return a JSON response.");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function geminiScriptPath() {
  return path.join(process.cwd(), "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
}

export class GeminiCliAssistantResponder implements AssistantResponder {
  async respond({ transcript, history, settings }: Parameters<AssistantResponder["respond"]>[0]) {
    const prompt = [
      "You are the local voice assistant for the user.",
      "Return only valid JSON with keys fullAnswer and spokenSummary.",
      `Assistant style: ${settings.assistantStyle}`,
      `Spoken summary target: ${settings.summaryWords} words or fewer.`,
      "Recent conversation:",
      formatHistory(history) || "(none yet)",
      "New user transcript:",
      transcript
    ].join("\n\n");

    try {
      const args = [geminiScriptPath(), "--prompt", prompt, "--skip-trust", "--approval-mode", "plan"];
      if (settings.assistantModel && settings.assistantModel !== "auto") {
        args.push("--model", settings.assistantModel);
      }

      const { stdout } = await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true
      });

      const parsed = parseJsonResponse(stdout) as {
        fullAnswer?: unknown;
        spokenSummary?: unknown;
      };

      if (typeof parsed.fullAnswer !== "string" || typeof parsed.spokenSummary !== "string") {
        throw new Error("Gemini CLI returned an invalid response shape.");
      }

      return {
        fullAnswer: parsed.fullAnswer.trim(),
        spokenSummary: parsed.spokenSummary.trim()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini CLI failed.";
      if (message.includes("Auth method") || message.includes("GEMINI_API_KEY")) {
        throw new Error(
          "Gemini CLI is installed but not signed in. Run `npm run gemini:login` in this app folder, choose Sign in with Google, then restart the server."
        );
      }
      throw error;
    }
  }
}
