import { describe, expect, it, vi } from "vitest";
import type { AssistantSettings } from "../shared/types";

vi.mock("./sessionManager", () => {
  const sessions: unknown[] = [];
  return {
    createBackgroundSession: vi.fn((input) => {
      const session = {
        id: "session-1",
        title: input.title,
        status: "running",
        mode: input.mode,
        prompt: input.prompt,
        createdAt: new Date().toISOString(),
        report: {
          summary: "",
          changed: "",
          verified: "",
          blockers: "",
          next: ""
        }
      };
      sessions.unshift(session);
      return session;
    }),
    listBackgroundSessions: vi.fn(() => sessions)
  };
});

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
  summaryWords: 45
};

describe("handlePlannerTurn", () => {
  it("delegates concrete work to a worker session", async () => {
    const { handlePlannerTurn } = await import("./plannerTurn");
    const { createBackgroundSession } = await import("./sessionManager");

    const result = await handlePlannerTurn("Implement the worker cards", [], settings);

    expect(createBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "execute",
        title: "Implement the worker cards"
      })
    );
    expect(result.assistantMessage.content).toContain("my take");
    expect(result.assistantMessage.content).toContain("started a worker");
    expect(result.spokenSummary).toContain("worker");
  });

  it("keeps brainstorming in the main session", async () => {
    const { handlePlannerTurn } = await import("./plannerTurn");

    const result = await handlePlannerTurn("What do you think about this approach?", [], settings);

    expect(result.assistantMessage.content).toContain("main planning session");
    expect(result.spokenSummary).toContain("my take");
  });

  it("summarizes worker status", async () => {
    const { handlePlannerTurn } = await import("./plannerTurn");

    const result = await handlePlannerTurn("What is the status?", [], settings);

    expect(result.assistantMessage.content).toContain("Workers:");
  });

  it("asks structured planning questions before plan-mode delegation", async () => {
    const { handlePlannerTurn } = await import("./plannerTurn");
    const planSettings = { ...settings, codexMode: "plan" as const };

    const result = await handlePlannerTurn("Build a voice UI plan for Codex sessions", [], planSettings);

    expect(result.plannerPrompt?.status).toBe("needs-input");
    expect(result.plannerPrompt?.questions.length).toBeGreaterThan(2);
    expect(result.assistantMessage.content).toContain("Planning questions");
    expect(result.spokenSummary).toContain("planning answers");
  });

  it("does not repeat planning questions after the user answers them", async () => {
    const { handlePlannerTurn } = await import("./plannerTurn");
    const planSettings = { ...settings, codexMode: "plan" as const };
    const history = [
      {
        id: "assistant-questions",
        role: "assistant" as const,
        content: "Planning questions for: Build a voice UI plan",
        createdAt: "2026-06-03T00:00:00.000Z"
      }
    ];

    const result = await handlePlannerTurn(
      "The goal is voice control for Codex. Scope should include planning, workers, and clear project visibility.",
      history,
      planSettings
    );

    expect(result.plannerPrompt).toBeUndefined();
    expect(result.assistantMessage.content).toContain("my take");
  });

  it("builds spoken summaries from the whole answer, not just the opening lines", async () => {
    const { spokenSummaryFrom } = await import("./plannerTurn");
    const answer = [
      "First, I understand the goal: the wrapper should feel conversational instead of like a dictation box.",
      "The middle detail is important because the planner needs persistent context, worker handoffs, and a way to recover after server errors.",
      "A background worker was started so the implementation can happen separately while the main session stays available.",
      "Next, I would verify refresh recovery and make sure the spoken output reflects the actual summary."
    ].join(" ");

    const summary = spokenSummaryFrom(answer, settings, "Session consistency");

    expect(summary).toContain("First");
    expect(summary).toContain("background worker");
    expect(summary).toContain("Next");
  });
});
