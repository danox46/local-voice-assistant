import { describe, expect, it } from "vitest";
import { formatPlannerSessionMarkdown, removeLastPlannerTurnFromSession } from "./plannerSessionStore";

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
});
