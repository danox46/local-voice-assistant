import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantSettings, BackgroundSession } from "../shared/types";

const sessions: BackgroundSession[] = [];

vi.mock("./plannerTurn", () => ({
  spokenSummaryFrom: vi.fn((answer: string) => answer.split(/\s+/).slice(0, 12).join(" "))
}));

vi.mock("./sessionManager", () => ({
  archiveBackgroundSession: vi.fn((id: string) => {
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) return undefined;
    session.archivedAt = "2026-06-03T12:00:00.000Z";
    return session;
  }),
  cancelBackgroundSession: vi.fn((id: string) => {
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session || session.status !== "running") return false;
    session.status = "cancelled";
    return true;
  }),
  createBackgroundSession: vi.fn((input) => {
    const session = makeSession({
      id: "session-follow-up",
      title: input.title,
      status: "running",
      mode: input.mode,
      prompt: input.prompt
    });
    sessions.unshift(session);
    return session;
  }),
  focusBackgroundSession: vi.fn((id: string) => {
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) return undefined;
    for (const candidate of sessions) candidate.focused = false;
    session.focused = true;
    return session;
  }),
  getFocusedBackgroundSession: vi.fn(() => sessions.find((session) => session.focused)),
  inspectBackgroundSession: vi.fn((id: string) => ({
    sessionId: id,
    issueFound: true,
    userNeeded: false,
    severity: "warning",
    summary: "The worker hit a test failure.",
    evidence: "npm test failed in App.test.tsx",
    inspectedAt: "2026-06-03T12:00:00.000Z"
  })),
  listBackgroundSessions: vi.fn(() => sessions)
}));

const settings: AssistantSettings = {
  backend: "codex-cli",
  codexMode: "execute",
  transcriptionMode: "browser",
  speechLanguage: "en-US",
  assistantStyle: "Warm and concise",
  assistantModel: "auto",
  transcribeModel: "none",
  ttsModel: "browser",
  voice: "browser",
  summaryWords: 35
};

function makeSession(overrides: Partial<BackgroundSession>): BackgroundSession {
  return {
    id: "session-1",
    title: "Worker",
    status: "running",
    mode: "execute",
    prompt: "Do work",
    createdAt: "2026-06-03T10:00:00.000Z",
    report: {
      summary: "Report summary.",
      changed: "None.",
      verified: "Not checked.",
      blockers: "None.",
      next: "Review."
    },
    supervision: {
      level: "normal",
      reason: "Session is progressing normally.",
      userNeeded: false,
      shouldNotify: false,
      checkedAt: "2026-06-03T10:00:00.000Z"
    },
    focused: false,
    ...overrides
  };
}

describe("handleSessionCommand", () => {
  beforeEach(() => {
    sessions.splice(0, sessions.length);
    vi.clearAllMocks();
  });

  it("focuses the latest visible worker by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    sessions.push(
      makeSession({ id: "latest", title: "Latest worker", createdAt: "2026-06-03T11:00:00.000Z" })
    );

    const result = handleSessionCommand("Focus the latest worker", [], settings);

    expect(result?.assistantMessage.content).toContain("Focused worker");
    expect(sessions[0].focused).toBe(true);
  });

  it("archives only completed or cancelled visible workers", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    sessions.push(
      makeSession({ id: "done", title: "Done worker", status: "done" }),
      makeSession({ id: "cancelled", title: "Cancelled worker", status: "cancelled" }),
      makeSession({ id: "running", title: "Running worker", status: "running" }),
      makeSession({ id: "blocked", title: "Blocked worker", status: "blocked" })
    );

    const result = handleSessionCommand("Archive completed workers", [], settings);

    expect(result?.assistantMessage.content).toContain("Archived 2");
    expect(sessions.find((session) => session.id === "done")?.archivedAt).toBeTruthy();
    expect(sessions.find((session) => session.id === "cancelled")?.archivedAt).toBeTruthy();
    expect(sessions.find((session) => session.id === "running")?.archivedAt).toBeUndefined();
    expect(sessions.find((session) => session.id === "blocked")?.archivedAt).toBeUndefined();
  });

  it("starts and focuses a follow-up worker from the current worker", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    sessions.push(makeSession({ id: "focused", title: "Focused worker", focused: true }));

    const result = handleSessionCommand("Continue the current worker", [], settings);

    expect(result?.assistantMessage.content).toContain("Started a follow-up worker");
    expect(sessions[0].id).toBe("session-follow-up");
    expect(sessions[0].focused).toBe(true);
  });

  it("switches Codex workers into plan-only mode by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("Switch to plan mode", [], settings);

    expect(result?.settings.codexMode).toBe("plan");
    expect(result?.assistantMessage.content).toContain("plan-only mode");
    expect(result?.spokenSummary).toContain("plan-only");
  });

  it("switches Codex workers back into execute mode by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    const planSettings = { ...settings, codexMode: "plan" as const };

    const result = handleSessionCommand("Use execute mode so workers can make changes", [], planSettings);

    expect(result?.settings.codexMode).toBe("execute");
    expect(result?.assistantMessage.content).toContain("execute mode");
  });

  it("reports the current Codex worker mode", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("What mode are we in?", [], settings);

    expect(result?.assistantMessage.content).toContain("Current Codex mode");
    expect(result?.spokenSummary).toContain("execute");
  });

  it("returns undefined for ordinary conversational turns", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    expect(handleSessionCommand("What do you think about the UI?", [], settings)).toBeUndefined();
    expect(handleSessionCommand("Plan the next version of the UI", [], settings)).toBeUndefined();
  });
});
