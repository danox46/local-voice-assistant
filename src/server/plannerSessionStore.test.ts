import { describe, expect, it } from "vitest";
import {
  appendPlannerTurnToSession,
  formatPlannerSessionMarkdown,
  removeLastPlannerTurnFromSession,
  updateActivePlannerQuestionInSession
} from "./plannerSessionStore";

describe("formatPlannerSessionMarkdown", () => {
  it("exports the saved planning session as readable markdown", () => {
    const markdown = formatPlannerSessionMarkdown({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:05:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Plan the voice cockpit.",
          createdAt: "2026-06-03T10:01:00.000Z"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "We should add worker controls and readiness indicators.",
          createdAt: "2026-06-03T10:02:00.000Z"
        }
      ]
    });

    expect(markdown).toContain("# Main planning session");
    expect(markdown).toContain("## 1. User");
    expect(markdown).toContain("Plan the voice cockpit.");
    expect(markdown).toContain("## 2. Assistant");
    expect(markdown).toContain("worker controls");
  });

  it("exports empty sessions clearly", () => {
    const markdown = formatPlannerSessionMarkdown({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z",
      messages: []
    });

    expect(markdown).toContain("_No saved messages yet._");
  });

  it("exports active planning questions when present", () => {
    const markdown = formatPlannerSessionMarkdown({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:05:00.000Z",
      messages: [],
      activePlannerPrompt: {
        topic: "Voice cockpit plan",
        status: "needs-input",
        questions: [
          {
            id: "goal",
            label: "Goal",
            question: "What should this accomplish?",
            why: "The planner needs a target."
          }
        ]
      }
    });

    expect(markdown).toContain("## Active Planning Questions");
    expect(markdown).toContain("Topic: Voice cockpit plan");
    expect(markdown).toContain("What should this accomplish?");
  });

  it("removes the latest user and assistant pair for retry", () => {
    const session = removeLastPlannerTurnFromSession({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:05:00.000Z",
      lastError: "Previous turn failed.",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Keep this.",
          createdAt: "2026-06-03T10:01:00.000Z"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Keeping it.",
          createdAt: "2026-06-03T10:02:00.000Z"
        },
        {
          id: "user-2",
          role: "user",
          content: "Retry this.",
          createdAt: "2026-06-03T10:03:00.000Z"
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "Bad answer.",
          createdAt: "2026-06-03T10:04:00.000Z"
        }
      ]
    });

    expect(session.lastError).toBeUndefined();
    expect(session.messages).toHaveLength(2);
    expect(session.messages.at(-1)?.content).toBe("Keeping it.");
  });

  it("stores and clears active planner prompts with planner turns", () => {
    const prompt = {
      topic: "Voice UI plan",
      status: "needs-input" as const,
      questions: [
        {
          id: "goal",
          label: "Goal",
          question: "What should this accomplish?",
          why: "The planner needs a target."
        }
      ]
    };
    const userMessage = {
      id: "user-1",
      role: "user" as const,
      content: "Plan the voice UI.",
      createdAt: "2026-06-03T10:01:00.000Z"
    };
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Planning questions.",
      createdAt: "2026-06-03T10:02:00.000Z"
    };

    const initialSession = {
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z",
      messages: []
    };
    const withPrompt = appendPlannerTurnToSession(initialSession, userMessage, assistantMessage, prompt);

    expect(withPrompt.activePlannerPrompt?.topic).toBe("Voice UI plan");

    const answered = appendPlannerTurnToSession(
      withPrompt,
      { ...userMessage, id: "user-2", content: "The goal is Codex voice control." },
      { ...assistantMessage, id: "assistant-2", content: "Great, I can proceed." }
    );

    expect(answered.activePlannerPrompt).toBeUndefined();
  });

  it("marks active planner questions answered or pending", () => {
    const session = {
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z",
      messages: [],
      activePlannerPrompt: {
        topic: "Voice UI plan",
        status: "needs-input" as const,
        questions: [
          {
            id: "goal",
            label: "Goal",
            question: "What should this accomplish?",
            why: "The planner needs a target."
          }
        ]
      }
    };

    const answered = updateActivePlannerQuestionInSession(session, "goal", true);
    const pending = updateActivePlannerQuestionInSession(answered, "goal", false);

    expect(answered.activePlannerPrompt?.questions[0].answeredAt).toBeTruthy();
    expect(pending.activePlannerPrompt?.questions[0].answeredAt).toBeUndefined();
  });
});
