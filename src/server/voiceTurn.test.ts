import { describe, expect, it, vi } from "vitest";
import type { AssistantSettings } from "../shared/types";
import { handleVoiceTurn } from "./voiceTurn";
import type { AssistantResponder, SpeechSynthesizer, Transcriber } from "./types";

const settings: AssistantSettings = {
  backend: "openai",
  codexMode: "execute",
  transcriptionMode: "openai-cloud",
  speechLanguage: "en-US",
  assistantStyle: "Concise and friendly",
  assistantModel: "test-assistant",
  transcribeModel: "test-transcribe",
  ttsModel: "test-tts",
  voice: "marin",
  summaryWords: 35
};

describe("handleVoiceTurn", () => {
  it("transcribes, responds, synthesizes, and returns the complete voice turn", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn().mockResolvedValue("What is on my calendar?")
    };
    const assistant: AssistantResponder = {
      respond: vi.fn().mockResolvedValue({
        fullAnswer: "You have two meetings today and a free afternoon.",
        spokenSummary: "You have two meetings, then a free afternoon."
      })
    };
    const speech: SpeechSynthesizer = {
      synthesize: vi.fn().mockResolvedValue({
        audio: Buffer.from("audio"),
        mimeType: "audio/mpeg"
      })
    };

    const result = await handleVoiceTurn(
      {
        buffer: Buffer.from("recording"),
        filename: "recording.webm",
        mimeType: "audio/webm"
      },
      [],
      settings,
      { transcriber, assistant, speech }
    );

    expect(result.userMessage.content).toBe("What is on my calendar?");
    expect(result.assistantMessage.content).toBe(
      "You have two meetings today and a free afternoon."
    );
    expect(result.spokenSummary).toBe("You have two meetings, then a free afternoon.");
    expect(result.audioBase64).toBe(Buffer.from("audio").toString("base64"));
    expect(assistant.respond).toHaveBeenCalledWith({
      transcript: "What is on my calendar?",
      history: [],
      settings
    });
  });

  it("rejects empty recordings", async () => {
    await expect(
      handleVoiceTurn(
        { buffer: Buffer.alloc(0), filename: "empty.webm", mimeType: "audio/webm" },
        [],
        settings,
        {
          transcriber: { transcribe: vi.fn() },
          assistant: { respond: vi.fn() },
          speech: { synthesize: vi.fn() }
        }
      )
    ).rejects.toThrow("recording was empty");
  });
});
