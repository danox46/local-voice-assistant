import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, containsWakePhrase, splitSpeechIntoChunks } from "./App";
import * as api from "./api";

vi.mock("./api");

const settings = {
  backend: "codex-cli" as const,
  codexMode: "execute" as const,
  transcriptionMode: "browser" as const,
  speechLanguage: "en-US",
  assistantStyle: "Warm and concise",
  assistantModel: "auto",
  transcribeModel: "gpt-4o-mini-transcribe",
  ttsModel: "gpt-4o-mini-tts",
  voice: "marin",
  summaryWords: 45
};

describe("App", () => {
  beforeEach(() => {
    vi.mocked(api.getHealth).mockResolvedValue({
      ok: true,
      hasOpenAiKey: true,
      hasGeminiCli: true,
      hasCodexCli: true,
      settings,
      activeListenerMode: "push-to-talk",
      listenerModes: [],
      integrations: []
    });
    vi.mocked(api.listSessions).mockResolvedValue([]);
    vi.mocked(api.cancelSession).mockResolvedValue({ cancelled: true });
    vi.mocked(api.getPlannerSession).mockResolvedValue({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      messages: []
    });
    vi.mocked(api.resetPlannerSession).mockResolvedValue({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      messages: []
    });
  });

  it("renders the primary voice assistant controls", async () => {
    render(<App />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Full response")).toBeInTheDocument();
    expect(screen.getByText("Worker Sessions")).toBeInTheDocument();
    expect(screen.getByText("Spoken summary · AI-generated voice")).toBeInTheDocument();
    expect(screen.getByText('Wake on "tensoon"')).toBeInTheDocument();
  });

  it("shows the setup message when Codex CLI is missing", async () => {
    vi.mocked(api.getHealth).mockResolvedValueOnce({
      ok: true,
      hasOpenAiKey: false,
      hasGeminiCli: true,
      hasCodexCli: false,
      settings,
      activeListenerMode: "push-to-talk",
      listenerModes: [],
      integrations: []
    });

    render(<App />);

    expect(await screen.findByText(/Codex CLI is not installed/)).toBeInTheDocument();
  });

  it("splits long spoken summaries into reliable playback chunks", () => {
    const chunks = splitSpeechIntoChunks(
      "This is the first sentence and it should stay together. This is the second sentence with useful context. This final sentence should also be heard.",
      70
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("final sentence");
    expect(chunks.every((chunk) => chunk.length <= 90)).toBe(true);
  });

  it("recognizes the Tensoon wake phrase from likely transcripts", () => {
    expect(containsWakePhrase("Tensoon")).toBe(true);
    expect(containsWakePhrase("hey ten soon start listening")).toBe(true);
    expect(containsWakePhrase("tension please")).toBe(true);
    expect(containsWakePhrase("keep waiting for now")).toBe(false);
  });
});
