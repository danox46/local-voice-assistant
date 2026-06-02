import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
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
  });

  it("renders the primary voice assistant controls", async () => {
    render(<App />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Full response")).toBeInTheDocument();
    expect(screen.getByText("Spoken summary · AI-generated voice")).toBeInTheDocument();
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
});
