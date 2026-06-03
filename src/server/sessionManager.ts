import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  BackgroundSession,
  BackgroundSessionMode,
  BackgroundSessionReport,
  BackgroundSessionStatus
} from "../shared/types";
import { config } from "./config";

interface RunningSession {
  child: ChildProcessWithoutNullStreams;
  outputFile: string;
  timeout: NodeJS.Timeout;
}

interface CreateSessionInput {
  title: string;
  prompt: string;
  mode: BackgroundSessionMode;
}

const sessions = new Map<string, BackgroundSession>();
const runningSessions = new Map<string, RunningSession>();

function codexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function emptyReport(): BackgroundSessionReport {
  return {
    summary: "",
    changed: "",
    verified: "",
    blockers: "",
    next: ""
  };
}

function reportDir() {
  return path.join(process.cwd(), "work", "session-reports");
}

function outputDir() {
  return path.join(process.cwd(), "work", "codex-runs");
}

function sessionPrompt(session: BackgroundSession) {
  return [
    "You are a background Codex session managed by a local voice wrapper.",
    "Work only on the bounded task below. Keep changes focused and avoid publishing, deployment, or Git operations unless explicitly requested.",
    session.mode === "plan"
      ? "PLAN MODE: inspect and plan only. Do not edit files or mutate project state."
      : "EXECUTE MODE: you may edit files as needed.",
    "Return your final answer in exactly this shape:",
    "Session: short nickname",
    "Status: done | blocked | failed | still running",
    "Summary: 1-3 sentences",
    "Changed: files or artifacts, if any",
    "Verified: commands or checks run, with key result",
    "Blockers: concrete blockers only",
    "Next: one recommended action",
    "Task:",
    session.prompt
  ].join("\n\n");
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
  return stdout.trim();
}

function parseField(output: string, label: keyof BackgroundSessionReport) {
  const labels = ["Summary", "Changed", "Verified", "Blockers", "Next"];
  const startLabel = label[0].toUpperCase() + label.slice(1);
  const start = output.match(new RegExp(`^${startLabel}:\\s*`, "im"));
  if (!start || start.index === undefined) return "";
  const contentStart = start.index + start[0].length;
  const next = labels
    .filter((candidate) => candidate !== startLabel)
    .map((candidate) => output.slice(contentStart).search(new RegExp(`\\n${candidate}:\\s*`, "i")))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return output.slice(contentStart, next === undefined ? undefined : contentStart + next).trim();
}

function parseStatus(output: string, code: number | null): BackgroundSessionStatus {
  if (code && code !== 0) return "failed";
  const statusMatch = output.match(/^Status:\s*(.+)$/im);
  const status = statusMatch?.[1]?.toLowerCase() ?? "";
  if (status.includes("blocked")) return "blocked";
  if (status.includes("failed")) return "failed";
  if (status.includes("running")) return "running";
  return "done";
}

function parseReport(output: string): BackgroundSessionReport {
  return {
    summary: parseField(output, "summary") || output.split(/\r?\n/).find(Boolean) || "",
    changed: parseField(output, "changed") || "None reported.",
    verified: parseField(output, "verified") || "Not reported.",
    blockers: parseField(output, "blockers") || "None reported.",
    next: parseField(output, "next") || "Review the session output."
  };
}

async function writeReport(session: BackgroundSession) {
  await fs.promises.mkdir(reportDir(), { recursive: true });
  const body = [
    `# ${session.title}`,
    "",
    `Session: ${session.id}`,
    `Status: ${session.status}`,
    `Mode: ${session.mode}`,
    `Started: ${session.startedAt ?? ""}`,
    `Finished: ${session.finishedAt ?? ""}`,
    "",
    "## Summary",
    session.report.summary,
    "",
    "## Changed",
    session.report.changed,
    "",
    "## Verified",
    session.report.verified,
    "",
    "## Blockers",
    session.report.blockers,
    "",
    "## Next",
    session.report.next,
    "",
    "## Raw Output",
    session.rawOutput ?? ""
  ].join("\n");
  await fs.promises.writeFile(path.join(reportDir(), `${session.id}.md`), body, "utf8");
}

function finishSession(id: string, patch: Partial<BackgroundSession>) {
  const session = sessions.get(id);
  if (!session) return;
  const next = {
    ...session,
    ...patch,
    finishedAt: patch.finishedAt ?? new Date().toISOString()
  };
  sessions.set(id, next);
  runningSessions.delete(id);
  void writeReport(next).catch((error) => {
    console.error(`[${new Date().toISOString()}] session report write failed`, error);
  });
}

export function listBackgroundSessions() {
  return [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackgroundSession(id: string) {
  return sessions.get(id);
}

export function createBackgroundSession(input: CreateSessionInput) {
  const id = createId();
  const now = new Date().toISOString();
  const session: BackgroundSession = {
    id,
    title: input.title.trim() || "Background session",
    status: "queued",
    mode: input.mode,
    prompt: input.prompt.trim(),
    createdAt: now,
    report: emptyReport()
  };
  sessions.set(id, session);
  startSession(session);
  return sessions.get(id)!;
}

function startSession(session: BackgroundSession) {
  fs.mkdirSync(outputDir(), { recursive: true });
  const outputFile = path.join(outputDir(), `${session.id}.txt`);
  const child = spawn(
    codexCommand(),
    [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      session.mode === "plan" ? "read-only" : "danger-full-access",
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

  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => {
    child.kill();
    finishSession(session.id, {
      status: "failed",
      error: "Codex CLI timed out.",
      report: {
        ...emptyReport(),
        summary: "The background session timed out before returning a report.",
        blockers: "Codex CLI exceeded the 12 minute session timeout.",
        next: "Restart with a narrower prompt."
      }
    });
  }, 1000 * 60 * 12);

  runningSessions.set(session.id, { child, outputFile, timeout });
  sessions.set(session.id, {
    ...session,
    status: "running",
    startedAt: new Date().toISOString()
  });

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    clearTimeout(timeout);
    finishSession(session.id, {
      status: "failed",
      error: error.message,
      report: {
        ...emptyReport(),
        summary: "The background session could not start.",
        blockers: error.message,
        next: "Check that Codex CLI is installed and available on PATH."
      }
    });
  });
  child.on("close", (code) => {
    clearTimeout(timeout);
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (sessions.get(session.id)?.status === "cancelled") return;
    const lastMessage = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8").trim() : "";
    fs.rmSync(outputFile, { force: true });
    const rawOutput = lastMessage || extractCodexAnswer(combined) || combined;
    finishSession(session.id, {
      status: parseStatus(rawOutput, code),
      rawOutput,
      error: code && code !== 0 ? combined || `Codex CLI exited with code ${code}.` : undefined,
      report: parseReport(rawOutput)
    });
  });

  child.stdin.write(sessionPrompt(session));
  child.stdin.end();
}

export function cancelBackgroundSession(id: string) {
  const running = runningSessions.get(id);
  const session = sessions.get(id);
  if (!session || !running) return false;
  clearTimeout(running.timeout);
  running.child.kill();
  finishSession(id, {
    status: "cancelled",
    report: {
      ...emptyReport(),
      summary: "The background session was cancelled.",
      blockers: "Cancelled by the user.",
      next: "Start a new session if the work is still needed."
    }
  });
  return true;
}
