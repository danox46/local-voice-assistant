import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  containsWakePhrase,
  historyWithoutLastTurn,
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
    vi.clearAllMocks();
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
    vi.mocked(api.exportPlannerSession).mockResolvedValue(new Blob(["# Main planning session"]));
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
    vi.mocked(api.retryLastTextTurn).mockResolvedValue({
      userMessage: {
        id: "user-retry",
        role: "user",
        content: "Retry request.",
        createdAt: "2026-06-02T00:01:00.000Z"
      },
      assistantMessage: {
        id: "assistant-retry",
        role: "assistant",
        content: "Retry answer.",
        createdAt: "2026-06-02T00:01:30.000Z"
      },
      spokenSummary: "Retry answer.",
      settings
    });
  });

  it("renders the primary voice assistant controls", async () => {
    render(<App />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Full response")).toBeInTheDocument();
    expect(screen.getByText("System Readiness")).toBeInTheDocument();
    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(screen.getByText("Codex CLI")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
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

  it("exports the planner transcript from the toolbar", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:planner");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);

    await screen.findByText("System Readiness");
    await user.click(screen.getByRole("button", { name: "Export transcript" }));

    expect(api.exportPlannerSession).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:planner");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
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

  it("retries the latest planner turn after removing it from saved context", async () => {
    const user = userEvent.setup();
    const savedMessages = [
      {
        id: "user-1",
        role: "user" as const,
        content: "Build the voice cockpit.",
        createdAt: "2026-06-02T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        role: "assistant" as const,
        content: "Old answer.",
        createdAt: "2026-06-02T00:00:30.000Z"
      }
    ];
    vi.mocked(api.getPlannerSession).mockResolvedValueOnce({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:30.000Z",
      messages: savedMessages
    });
    vi.mocked(api.retryLastTextTurn).mockResolvedValueOnce({
      userMessage: {
        id: "user-2",
        role: "user",
        content: "Build the voice cockpit.",
        createdAt: "2026-06-02T00:01:00.000Z"
      },
      assistantMessage: {
        id: "assistant-2",
        role: "assistant",
        content: "Better answer.",
        createdAt: "2026-06-02T00:01:30.000Z"
      },
      spokenSummary: "Better answer.",
      settings,
      plannerSession: {
        id: "main",
        title: "Main planning session",
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:01:30.000Z",
        messages: [
          {
            id: "user-2",
            role: "user",
            content: "Build the voice cockpit.",
            createdAt: "2026-06-02T00:01:00.000Z"
          },
          {
            id: "assistant-2",
            role: "assistant",
            content: "Better answer.",
            createdAt: "2026-06-02T00:01:30.000Z"
          }
        ]
      }
    });

    render(<App />);

    await screen.findByText("Old answer.");
    await user.click(screen.getByRole("button", { name: /Retry last turn/ }));

    await waitFor(() => expect(api.retryLastTextTurn).toHaveBeenCalled());
    expect(api.retryLastTextTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        settings
      })
    );
    expect(api.sendTextTurn).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText("Better answer.").length).toBeGreaterThan(0));
  });

  it("sends typed retry commands through the retry endpoint", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Ready");
    await user.type(screen.getAllByLabelText("Type instead")[0], "retry last turn");
    await user.click(screen.getByRole("button", { name: "Send to Codex" }));

    await waitFor(() => expect(api.retryLastTextTurn).toHaveBeenCalled());
    expect(api.sendTextTurn).not.toHaveBeenCalled();
  });

  it("replays the latest response from a typed repeat command without sending a turn", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getPlannerSession).mockResolvedValueOnce({
      id: "main",
      title: "Main planning session",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:30.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Plan it.",
          createdAt: "2026-06-02T00:00:00.000Z"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Latest useful answer.",
          createdAt: "2026-06-02T00:00:30.000Z"
        }
      ]
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        speak: vi.fn()
      }
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        volume = 1;
        rate = 1;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;

        constructor(text: string) {
          this.text = text;
        }
      }
    );
    const speak = vi
      .spyOn(window.speechSynthesis, "speak")
      .mockImplementation(() => undefined);

    render(<App />);

    await screen.findByText("Latest useful answer.");
    await user.type(screen.getAllByLabelText("Type instead")[0], "repeat last response");
    await user.click(screen.getByRole("button", { name: "Send to Codex" }));

    await waitFor(() => expect(speak).toHaveBeenCalled());
    expect(api.sendTextTurn).not.toHaveBeenCalled();
    expect(api.retryLastTextTurn).not.toHaveBeenCalled();

    speak.mockRestore();
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
    expect(screen.getByText("Setup needed")).toBeInTheDocument();
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

  it("removes the latest user and assistant pair from local retry history", () => {
    const trimmed = historyWithoutLastTurn([
      {
        id: "user-1",
        role: "user",
        content: "Keep this",
        createdAt: "2026-06-02T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Kept",
        createdAt: "2026-06-02T00:00:30.000Z"
      },
      {
        id: "user-2",
        role: "user",
        content: "Retry this",
        createdAt: "2026-06-02T00:01:00.000Z"
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "Remove this",
        createdAt: "2026-06-02T00:01:30.000Z"
      }
    ]);

    expect(trimmed).toHaveLength(2);
    expect(trimmed.at(-1)?.content).toBe("Kept");
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
