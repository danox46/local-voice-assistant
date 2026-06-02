import { describe, expect, it, vi } from "vitest";
import type { AssistantSettings } from "../shared/types";
import { handleTextTurn } from "./textTurn";

const settings: AssistantSettings = {
  backend: "codex-cli",
  codexMode: "execute",
  transcriptionMode: "browser",
  speechLanguage: "en-US",
  assistantStyle: "Concise and friendly",
  assistantModel: "auto",
  transcribeModel: "none",
  ttsModel: "browser",
  voice: "browser",
  summaryWords: 35
};

describe("handleTextTurn", () => {
  it("uses the assistant responder and returns a text turn", async () => {
    const assistant = {
      respond: vi.fn().mockResolvedValue({
        fullAnswer: "Here is the complete answer.",
        spokenSummary: "Here is the short answer."
      })
    };

    const result = await handleTextTurn("hello", [], settings, assistant);

    expect(result.userMessage.content).toBe("hello");
    expect(result.assistantMessage.content).toBe("Here is the complete answer.");
    expect(result.spokenSummary).toBe("Here is the short answer.");
  });

  it("rejects empty transcripts", async () => {
    await expect(
      handleTextTurn(" ", [], settings, {
        respond: vi.fn()
      })
    ).rejects.toThrow("did not catch");
  });
});
