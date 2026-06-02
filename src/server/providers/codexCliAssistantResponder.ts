import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ConversationMessage } from "../../shared/types";
import { config } from "../config";
import { sanitizeAssistantResponseForAudio } from "../responseSanitizer";
import type { AssistantResponder } from "../types";

function formatHistory(history: ConversationMessage[]) {
  return history
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function codexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

let activeCodexChild: ChildProcessWithoutNullStreams | null = null;

export function cancelActiveCodexRun() {
  if (!activeCodexChild) return false;
  activeCodexChild.kill();
  activeCodexChild = null;
  return true;
}

function runCodexExec(prompt: string, mode: "execute" | "plan") {
  return new Promise<string>((resolve, reject) => {
    const outputDir = path.join(process.cwd(), "work", "codex-runs");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(
      outputDir,
      `${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
    );
    const child = spawn(
      codexCommand(),
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        mode === "plan" ? "read-only" : "danger-full-access",
        "--color",
        "never",
        "--output-last-message",
        outputFile,
        "--cd",
        config.CODEX_WORKDIR,
        "-"
      ],
      {
        cwd: config.CODEX_WORKDIR,
        shell: process.platform === "win32",
        windowsHide: true
      }
    );
    activeCodexChild = child;

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Codex CLI timed out while working on the dictated instruction."));
    }, 1000 * 60 * 8);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (activeCodexChild === child) activeCodexChild = null;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (activeCodexChild === child) activeCodexChild = null;
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (code === null) {
        reject(new Error("Codex run was cancelled."));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(combined || `Codex CLI exited with code ${code}.`));
        return;
      }
      const lastMessage = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8").trim()
        : "";
      fs.rmSync(outputFile, { force: true });
      resolve(lastMessage || extractCodexAnswer(combined));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractCodexAnswer(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const markerIndex = lines.lastIndexOf("codex");
  if (markerIndex >= 0 && lines[markerIndex + 1]) {
    const endIndex = lines.findIndex((line, index) => index > markerIndex && line === "tokens used");
    return lines.slice(markerIndex + 1, endIndex > markerIndex ? endIndex : undefined).join("\n");
  }
  return lines.find((line) => !line.startsWith("20") && !line.includes("WARN")) ?? stdout.trim();
}

function summarizeForSpeech(text: string, wordLimit: number) {
  const clean = sanitizeAssistantResponseForAudio(text).replace(/\s+/g, " ").trim();
  const words = clean.split(" ");
  if (words.length <= wordLimit) return clean;
  return `${words.slice(0, wordLimit).join(" ")}...`;
}

export class CodexCliAssistantResponder implements AssistantResponder {
  async respond({ transcript, history, settings }: Parameters<AssistantResponder["respond"]>[0]) {
    const prompt = [
      "You are being controlled by a local voice wrapper.",
      "Use the user's dictated instruction to help with the project in this working directory.",
      settings.codexMode === "plan"
        ? "PLAN MODE: do not edit files, run write commands, or mutate project state. Return a complete but concise implementation plan only."
        : "EXECUTE MODE: you may edit files as needed. In the final response, give a complete 2-5 sentence summary. If you changed files, say what changed and what you verified. If you ran commands, include the key result instead of only saying that the command ran.",
      `Assistant style: ${settings.assistantStyle}`,
      "Recent voice conversation:",
      formatHistory(history) || "(none yet)",
      "Dictated instruction:",
      transcript
    ].join("\n\n");

    const combined = await runCodexExec(prompt, settings.codexMode);
    const fullAnswer = extractCodexAnswer(combined);

    return {
      fullAnswer,
      spokenSummary: summarizeForSpeech(fullAnswer, settings.summaryWords)
    };
  }
}
