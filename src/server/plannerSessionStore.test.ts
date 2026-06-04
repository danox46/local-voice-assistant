import { describe, expect, it } from "vitest";
import { formatPlannerSessionMarkdown } from "./plannerSessionStore";

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
});
