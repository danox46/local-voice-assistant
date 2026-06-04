import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantSettings, BackgroundSession } from "../shared/types";

const sessions: BackgroundSession[] = [];
const recordActivity = vi.fn();
const plannerSession = {
  id: "main",
  title: "Main planning session",
  createdAt: "2026-06-03T10:00:00.000Z",
  updatedAt: "2026-06-03T10:10:00.000Z",
  messages: [
    {
      id: "user-1",
      role: "user" as const,
      content: "Build a voice cockpit for Codex.",
      createdAt: "2026-06-03T10:00:00.000Z"
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: "We should add planner memory, workers, and activity tracking.",
      createdAt: "2026-06-03T10:01:00.000Z"
    }
  ],
  activePlannerPrompt: undefined as
    | {
        topic: string;
        status: "needs-input";
        questions: Array<{
          id: string;
          label: string;
          question: string;
          why: string;
          answeredAt?: string;
        }>;
      }
    | undefined
};

vi.mock("./activityFeed", () => ({
  recordActivity: (...args: unknown[]) => recordActivity(...args)
}));

vi.mock("./plannerTurn", () => ({
  spokenSummaryFrom: vi.fn((answer: string) => answer.split(/\s+/).slice(0, 12).join(" "))
}));

vi.mock("./plannerSessionStore", () => ({
  getPlannerSession: vi.fn(() => plannerSession),
  resetPlannerSession: vi.fn(() => ({
    ...plannerSession,
    updatedAt: "2026-06-03T10:12:00.000Z",
    messages: []
  })),
  updateActivePlannerQuestion: vi.fn((id: string, answered: boolean) => {
    if (!plannerSession.activePlannerPrompt) return plannerSession;
    plannerSession.activePlannerPrompt = {
      ...plannerSession.activePlannerPrompt,
      questions: plannerSession.activePlannerPrompt.questions.map((question) =>
        question.id === id
          ? {
              ...question,
              answeredAt: answered ? "2026-06-03T10:13:00.000Z" : undefined
            }
          : question
      )
    };
    return plannerSession;
  }),
  updateActivePlannerQuestions: vi.fn((answered: boolean) => {
    if (!plannerSession.activePlannerPrompt) return plannerSession;
    plannerSession.activePlannerPrompt = {
      ...plannerSession.activePlannerPrompt,
      questions: plannerSession.activePlannerPrompt.questions.map((question) => ({
        ...question,
        answeredAt: answered ? "2026-06-03T10:13:00.000Z" : undefined
      }))
    };
    return plannerSession;
  })
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
    plannerSession.activePlannerPrompt = undefined;
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

  it("continues only agent-actionable blocked workers by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    sessions.push(
      makeSession({
        id: "agent-actionable",
        title: "Agent actionable worker",
        status: "failed",
        supervision: {
          level: "auto-actionable",
          reason: "TypeScript error can be fixed by the agent.",
          userNeeded: false,
          shouldNotify: false,
          checkedAt: "2026-06-03T10:00:00.000Z"
        },
        report: {
          summary: "Build failed.",
          changed: "None.",
          verified: "npm run build failed.",
          blockers: "TypeScript error.",
          next: "Fix the type error."
        }
      }),
      makeSession({
        id: "user-needed",
        title: "User needed worker",
        status: "blocked",
        supervision: {
          level: "needs-user",
          reason: "Needs login approval.",
          userNeeded: true,
          shouldNotify: true,
          checkedAt: "2026-06-03T10:00:00.000Z"
        },
        report: {
          summary: "Login blocked.",
          changed: "None.",
          verified: "Tried auth check.",
          blockers: "Needs login approval.",
          next: "Ask the user to approve."
        }
      })
    );

    const result = handleSessionCommand("Continue actionable blockers", [], settings);

    expect(result?.assistantMessage.content).toContain("Started 1 follow-up worker");
    expect(result?.assistantMessage.content).toContain("Resolve Agent actionable worker");
    expect(result?.assistantMessage.content).not.toContain("Resolve User needed worker");
    expect(sessions[0].title).toBe("Resolve Agent actionable worker");
    expect(sessions[0].focused).toBe(true);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Actionable blockers continued" })
    );
  });

  it("does not continue user-needed blockers automatically", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    sessions.push(
      makeSession({
        id: "user-needed",
        title: "User needed worker",
        status: "blocked",
        supervision: {
          level: "needs-user",
          reason: "Needs API key.",
          userNeeded: true,
          shouldNotify: true,
          checkedAt: "2026-06-03T10:00:00.000Z"
        }
      })
    );

    const result = handleSessionCommand("Fix the blocked workers", [], settings);

    expect(result?.assistantMessage.content).toContain("do not see any visible blocked or failed workers");
    expect(sessions).toHaveLength(1);
  });

  it("switches Codex workers into plan-only mode by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("Switch to plan mode", [], settings);

    expect(result?.settings.codexMode).toBe("plan");
    expect(result?.assistantMessage.content).toContain("plan-only mode");
    expect(result?.spokenSummary).toContain("plan-only");
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({ title: "Plan mode enabled" }));
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
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({ title: "Mode checked" }));
  });

  it("answers voice command help requests", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("What can I say?", [], settings);

    expect(result?.assistantMessage.content).toContain("focus the latest worker");
    expect(result?.assistantMessage.content).toContain("switch to plan mode");
    expect(result?.assistantMessage.content).toContain("mark goal question answered");
    expect(result?.assistantMessage.content).toContain("repeat last response");
    expect(result?.assistantMessage.content).toContain("retry last turn");
    expect(result?.assistantMessage.content).toContain("continue actionable blockers");
    expect(result?.spokenSummary).toContain("Useful commands");
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Voice command help requested" })
    );
  });

  it("resets the main planning chat by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("Start a new chat", [], settings);

    expect(result?.plannerSession?.messages).toEqual([]);
    expect(result?.assistantMessage.content).toContain("fresh planning chat");
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Planner session reset" })
    );
  });

  it("recaps the main planning chat by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    const result = handleSessionCommand("Catch me up on the planning session", [], settings);

    expect(result?.assistantMessage.content).toContain("Main planning session");
    expect(result?.assistantMessage.content).toContain("Build a voice cockpit");
    expect(result?.spokenSummary).toContain("Latest request");
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Planner recap requested" })
    );
  });

  it("marks a named planning question answered by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    plannerSession.activePlannerPrompt = {
      topic: "Voice cockpit plan",
      status: "needs-input",
      questions: [
        {
          id: "goal",
          label: "Goal",
          question: "What should this accomplish?",
          why: "The planner needs a target."
        },
        {
          id: "scope",
          label: "Scope",
          question: "What should wait?",
          why: "Boundaries help the worker."
        }
      ]
    };

    const result = handleSessionCommand("Mark the goal question answered", [], settings);

    expect(result?.assistantMessage.content).toContain("Planning progress: 1/2 answered");
    expect(plannerSession.activePlannerPrompt.questions[0].answeredAt).toBeTruthy();
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Planning question updated" })
    );
  });

  it("marks all planning questions pending by voice", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");
    plannerSession.activePlannerPrompt = {
      topic: "Voice cockpit plan",
      status: "needs-input",
      questions: [
        {
          id: "goal",
          label: "Goal",
          question: "What should this accomplish?",
          why: "The planner needs a target.",
          answeredAt: "2026-06-03T10:13:00.000Z"
        },
        {
          id: "scope",
          label: "Scope",
          question: "What should wait?",
          why: "Boundaries help the worker.",
          answeredAt: "2026-06-03T10:13:00.000Z"
        }
      ]
    };

    const result = handleSessionCommand("Mark all planning questions pending", [], settings);

    expect(result?.assistantMessage.content).toContain("Planning progress: 0/2 answered");
    expect(plannerSession.activePlannerPrompt.questions.every((question) => !question.answeredAt)).toBe(true);
  });

  it("returns undefined for ordinary conversational turns", async () => {
    const { handleSessionCommand } = await import("./sessionCommands");

    expect(handleSessionCommand("What do you think about the UI?", [], settings)).toBeUndefined();
    expect(handleSessionCommand("Plan the next version of the UI", [], settings)).toBeUndefined();
  });
});
