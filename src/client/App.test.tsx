import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  containsWakePhrase,
  mergeStoredSettings,
  mergeStoredUiPrefs,
  splitSpeechIntoChunks
} from "./App";
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
    cleanup();
    window.localStorage.clear();
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
    vi.mocked(api.listActivity).mockResolvedValue([]);
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
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Voice Commands")).toBeInTheDocument();
    expect(screen.getByText("focus the latest worker")).toBeInTheDocument();
    expect(screen.getByText("Spoken summary · AI-generated voice")).toBeInTheDocument();
    expect(screen.getByText('Wake on "tensoon"')).toBeInTheDocument();
  });

  it("fills the typed prompt from a command example", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Ready");
    await user.click(screen.getAllByRole("button", { name: "focus the latest worker" })[0]);

    expect(screen.getAllByLabelText("Type instead")[0]).toHaveValue("focus the latest worker");
  });

  it("restores and clears the typed prompt draft", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "local-voice-assistant.typed-draft.v1",
      "Inspect the current worker"
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByLabelText("Type instead")[0]).toHaveValue("Inspect the current worker")
    );

    await user.click(screen.getAllByRole("button", { name: "Clear draft" })[0]);

    expect(screen.getAllByLabelText("Type instead")[0]).toHaveValue("");
    expect(window.localStorage.getItem("local-voice-assistant.typed-draft.v1")).toBeNull();
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

  it("merges valid stored assistant settings over server defaults", () => {
    const merged = mergeStoredSettings(
      settings,
      JSON.stringify({
        backend: "gemini-cli",
        codexMode: "plan",
        transcriptionMode: "gemini-cli-audio",
        summaryWords: 500,
        assistantStyle: "More direct"
      })
    );

    expect(merged.backend).toBe("gemini-cli");
    expect(merged.codexMode).toBe("plan");
    expect(merged.transcriptionMode).toBe("gemini-cli-audio");
    expect(merged.summaryWords).toBe(100);
    expect(merged.assistantStyle).toBe("More direct");
  });

  it("ignores invalid stored assistant settings", () => {
    const merged = mergeStoredSettings(
      settings,
      JSON.stringify({
        backend: "bad-backend",
        codexMode: "mutate",
        summaryWords: "loud"
      })
    );

    expect(merged.backend).toBe(settings.backend);
    expect(merged.codexMode).toBe(settings.codexMode);
    expect(merged.summaryWords).toBe(settings.summaryWords);
  });

  it("merges and clamps stored UI preferences", () => {
    expect(
      mergeStoredUiPrefs(JSON.stringify({ muted: true, wakeEnabled: false, volume: 3 }))
    ).toEqual({
      muted: true,
      wakeEnabled: false,
      volume: 1
    });
  });
});
