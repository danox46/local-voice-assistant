import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  BackgroundSession,
  BackgroundSessionMode,
  BackgroundSessionReport,
  BackgroundSessionStatus,
  SessionInspection,
  SessionSupervision
} from "../shared/types";
import { recordActivity } from "./activityFeed";
import { config } from "./config";

interface RunningSession {
  child: ChildProcessWithoutNullStreams;
  outputFile: string;
  timeout: NodeJS.Timeout;
  stdout: string;
  stderr: string;
  lastActivityAt: string;
}

interface CreateSessionInput {
  title: string;
  prompt: string;
  mode: BackgroundSessionMode;
}

const sessions = new Map<string, BackgroundSession>();
const runningSessions = new Map<string, RunningSession>();
const STALE_SESSION_MS = 1000 * 60 * 8;
let focusedSessionId: string | null = null;
let reportsHydrated = false;

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

function normalSupervision(reason = "Session is progressing normally."): SessionSupervision {
  return {
    level: "normal",
    reason,
    userNeeded: false,
    shouldNotify: false,
    checkedAt: new Date().toISOString()
  };
}

export function classifySessionSupervision(
  session: Pick<BackgroundSession, "status" | "startedAt" | "createdAt" | "report" | "error"> & {
    lastActivityAt?: string;
  },
  now = new Date()
): SessionSupervision {
  const checkedAt = now.toISOString();
  const blockers = session.report.blockers || "";
  const next = session.report.next || "";
  const combined = `${blockers} ${next} ${session.error ?? ""}`.toLowerCase();
  const activityAt = new Date(session.lastActivityAt ?? session.startedAt ?? session.createdAt).getTime();
  const quietMs = Number.isFinite(activityAt) ? now.getTime() - activityAt : 0;

  if ((session.status === "running" || session.status === "queued") && quietMs > STALE_SESSION_MS) {
    return {
      level: "stale",
      reason: "Session has been quiet longer than expected. Inspect logs before interrupting it.",
      userNeeded: false,
      shouldNotify: false,
      checkedAt
    };
  }

  if (session.status === "blocked" || session.status === "failed") {
    const userNeededPattern =
      /\b(user|owner|you|approval|approve|confirm|choose|decision|credential|login|permission|api key|secret|password|manual)\b/i;
    if (userNeededPattern.test(combined)) {
      return {
        level: "needs-user",
        reason: blockers || next || "The session needs a user decision or credential.",
        userNeeded: true,
        shouldNotify: true,
        checkedAt
      };
    }

    return {
      level: "auto-actionable",
      reason: blockers || next || "The session is blocked, but it appears actionable by the agent.",
      userNeeded: false,
      shouldNotify: false,
      checkedAt
    };
  }

  if (session.status === "done") {
    return normalSupervision("Session finished without requiring user action.");
  }

  if (session.status === "cancelled") {
    return normalSupervision("Session was cancelled.");
  }

  return normalSupervision();
}

function withSupervision(session: BackgroundSession) {
  const running = runningSessions.get(session.id);
  return {
    ...session,
    focused: session.id === focusedSessionId,
    supervision: classifySessionSupervision({
      ...session,
      lastActivityAt: running?.lastActivityAt
    })
  };
}

function tailText(text: string, maxLength = 1200) {
  const clean = text.trim();
  return clean.length > maxLength ? clean.slice(clean.length - maxLength) : clean;
}

export function inspectBackgroundSession(id: string): SessionInspection | undefined {
  const session = getBackgroundSession(id);
  if (!session) return undefined;
  const running = runningSessions.get(id);
  const output = tailText([running?.stdout, running?.stderr, session.rawOutput, session.error]
    .filter(Boolean)
    .join("\n"));
  const lower = output.toLowerCase();
  const inspectedAt = new Date().toISOString();
  const userNeededPattern =
    /\b(approval|approve|confirm|choose|credential|login|permission|api key|secret|password|manual|user input)\b/i;
  const issuePattern =
    /\b(error|exception|failed|denied|timeout|timed out|cannot|can't|missing|not found|permission|unauthorized|conflict)\b/i;

  if (session.supervision.userNeeded || userNeededPattern.test(output)) {
    return {
      sessionId: id,
      issueFound: true,
      userNeeded: true,
      severity: "critical",
      summary: session.supervision.reason || "The session appears to need user input.",
      evidence: output || session.report.blockers || session.report.next,
      inspectedAt
    };
  }

  if (session.supervision.level === "auto-actionable" || issuePattern.test(lower)) {
    return {
      sessionId: id,
      issueFound: true,
      userNeeded: false,
      severity: "warning",
      summary: session.supervision.reason || "The session has an issue the agent can likely handle.",
      evidence: output || session.report.blockers || session.report.next,
      inspectedAt
    };
  }

  if (session.supervision.level === "stale") {
    return {
      sessionId: id,
      issueFound: false,
      userNeeded: false,
      severity: "info",
      summary: "The session is quiet, but no concrete issue was found in the available output.",
      evidence: output || "No output captured yet.",
      inspectedAt
    };
  }

  return {
    sessionId: id,
    issueFound: false,
    userNeeded: false,
    severity: "none",
    summary: "No issue found.",
    evidence: output || session.report.summary || "No output captured yet.",
    inspectedAt
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

function parseMarkdownSection(markdown: string, heading: string) {
  const start = markdown.match(new RegExp(`^## ${heading}\\s*$`, "im"));
  if (!start || start.index === undefined) return "";
  const contentStart = start.index + start[0].length;
  const next = markdown.slice(contentStart).search(/^##\s+/im);
  return markdown
    .slice(contentStart, next >= 0 ? contentStart + next : undefined)
    .trim();
}

function parseMarkdownLine(markdown: string, label: string) {
  return markdown.match(new RegExp(`^${label}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
}

function isBackgroundSessionStatus(value: string): value is BackgroundSessionStatus {
  return ["queued", "running", "done", "blocked", "failed", "cancelled"].includes(value);
}

function isBackgroundSessionMode(value: string): value is BackgroundSessionMode {
  return value === "execute" || value === "plan";
}

function sessionFromReportFile(filePath: string): BackgroundSession | undefined {
  try {
    const markdown = fs.readFileSync(filePath, "utf8");
    const id = parseMarkdownLine(markdown, "Session") || path.basename(filePath, ".md");
    const statusText = parseMarkdownLine(markdown, "Status");
    const modeText = parseMarkdownLine(markdown, "Mode");
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Restored worker";
    const status = isBackgroundSessionStatus(statusText) ? statusText : "done";
    const mode = isBackgroundSessionMode(modeText) ? modeText : "execute";
    const startedAt = parseMarkdownLine(markdown, "Started");
    const finishedAt = parseMarkdownLine(markdown, "Finished") || undefined;
    const rawOutput = parseMarkdownSection(markdown, "Raw Output");
    const createdAt = startedAt || finishedAt || new Date(fs.statSync(filePath).mtime).toISOString();
    const session: BackgroundSession = {
      id,
      title,
      status: status === "queued" || status === "running" ? "failed" : status,
      mode,
      prompt: "Restored from saved worker report.",
      createdAt,
      startedAt: startedAt || undefined,
      finishedAt,
      focused: false,
      report: {
        summary: parseMarkdownSection(markdown, "Summary"),
        changed: parseMarkdownSection(markdown, "Changed"),
        verified: parseMarkdownSection(markdown, "Verified"),
        blockers: parseMarkdownSection(markdown, "Blockers"),
        next: parseMarkdownSection(markdown, "Next")
      },
      supervision: normalSupervision("Session restored from saved report."),
      rawOutput
    };
    session.supervision = classifySessionSupervision(session);
    return session;
  } catch {
    return undefined;
  }
}

function hydrateSessionsFromReports() {
  if (reportsHydrated) return;
  reportsHydrated = true;
  const dir = reportDir();
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const session = sessionFromReportFile(path.join(dir, entry));
    if (session && !sessions.has(session.id)) {
      sessions.set(session.id, session);
    }
  }
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
  } as BackgroundSession;
  next.supervision = classifySessionSupervision(next);
  sessions.set(id, next);
  runningSessions.delete(id);
  recordActivity({
    kind: "worker",
    title: `Worker ${next.status}`,
    detail: `${next.title}: ${next.report.summary || next.error || "Session finished."}`,
    sessionId: next.id,
    severity:
      next.status === "done"
        ? "success"
        : next.supervision.userNeeded
          ? "critical"
          : next.status === "failed" || next.status === "blocked"
            ? "warning"
            : "info"
  });
  void writeReport(next).catch((error) => {
    console.error(`[${new Date().toISOString()}] session report write failed`, error);
  });
}

export function listBackgroundSessions() {
  hydrateSessionsFromReports();
  const nextSessions = [...sessions.values()].map(withSupervision);
  for (const session of nextSessions) {
    sessions.set(session.id, session);
  }
  return nextSessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackgroundSession(id: string) {
  hydrateSessionsFromReports();
  const session = sessions.get(id);
  if (!session) return undefined;
  const supervised = withSupervision(session);
  sessions.set(id, supervised);
  return supervised;
}

export function getFocusedBackgroundSession() {
  return focusedSessionId ? getBackgroundSession(focusedSessionId) : undefined;
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
    supervision: normalSupervision("Session is queued."),
    focused: false,
    createdAt: now,
    report: emptyReport()
  };
  sessions.set(id, session);
  recordActivity({
    kind: "worker",
    title: "Worker queued",
    detail: `${session.title} started in ${session.mode} mode.`,
    sessionId: session.id,
    severity: "info"
  });
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

  runningSessions.set(session.id, {
    child,
    outputFile,
    timeout,
    stdout: "",
    stderr: "",
    lastActivityAt: new Date().toISOString()
  });
  sessions.set(session.id, {
    ...session,
    supervision: normalSupervision("Session is running."),
    focused: session.id === focusedSessionId,
    status: "running",
    startedAt: new Date().toISOString()
  });

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    const running = runningSessions.get(session.id);
    if (running) {
      running.stdout += text;
      running.lastActivityAt = new Date().toISOString();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    const running = runningSessions.get(session.id);
    if (running) {
      running.stderr += text;
      running.lastActivityAt = new Date().toISOString();
    }
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

export function focusBackgroundSession(id: string) {
  const session = sessions.get(id);
  if (!session) return undefined;
  focusedSessionId = id;
  const focused = withSupervision(session);
  sessions.set(id, focused);
  recordActivity({
    kind: "focus",
    title: "Focused worker",
    detail: `${focused.title} is now the current worker context.`,
    sessionId: focused.id,
    severity: "info"
  });
  return focused;
}

export function archiveBackgroundSession(id: string) {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (focusedSessionId === id) focusedSessionId = null;
  const archived = withSupervision({
    ...session,
    archivedAt: new Date().toISOString()
  });
  sessions.set(id, archived);
  recordActivity({
    kind: "archive",
    title: "Archived worker",
    detail: `${archived.title} was hidden from the main worker list.`,
    sessionId: archived.id,
    severity: "info"
  });
  return archived;
}

export function resetBackgroundSessionStateForTests() {
  sessions.clear();
  runningSessions.clear();
  focusedSessionId = null;
  reportsHydrated = false;
}
