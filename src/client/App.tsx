import {
  Bot,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Square,
  Terminal,
  Volume2,
  VolumeX
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantSettings, ConversationMessage, VoiceTurnResponse } from "../shared/types";
import { cancelTurn, getHealth, sendAudioTextTurn, sendTextTurn, sendVoiceTurn } from "./api";
import { MicActivityMonitor, PushToTalkRecorder, PushToTalkSpeechRecognizer } from "./recorder";

type UiState = "loading" | "idle" | "recording" | "thinking" | "speaking" | "error";
const AUTO_STOP_AFTER_MS = 1800;

const fallbackSettings: AssistantSettings = {
  backend: "codex-cli",
  codexMode: "execute",
  transcriptionMode: "browser",
  speechLanguage: "en-US",
  assistantStyle:
    "Warm, concise, practical, and direct. Keep the full answer useful, and keep the spoken summary short enough to hear comfortably.",
  assistantModel: "auto",
  transcribeModel: "gpt-4o-mini-transcribe",
  ttsModel: "gpt-4o-mini-tts",
  voice: "marin",
  summaryWords: 45
};

function audioUrlFromResponse(turn: VoiceTurnResponse) {
  const bytes = Uint8Array.from(atob(turn.audioBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: turn.audioMimeType });
  return URL.createObjectURL(blob);
}

function statusCopy(state: UiState) {
  if (state === "recording") return "Listening";
  if (state === "thinking") return "Thinking";
  if (state === "speaking") return "Speaking";
  if (state === "error") return "Needs attention";
  if (state === "loading") return "Starting";
  return "Ready";
}

export function App() {
  const [uiState, setUiState] = useState<UiState>("loading");
  const [settings, setSettings] = useState<AssistantSettings>(fallbackSettings);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [spokenSummary, setSpokenSummary] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [error, setError] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [typedPrompt, setTypedPrompt] = useState("");
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [hasGeminiCli, setHasGeminiCli] = useState(false);
  const [hasCodexCli, setHasCodexCli] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [micLevel, setMicLevel] = useState(0);
  const [autoStopRemaining, setAutoStopRemaining] = useState(0);

  const recorderRef = useRef(new PushToTalkRecorder());
  const recognizerRef = useRef<PushToTalkSpeechRecognizer | null>(null);
  const micMonitorRef = useRef(new MicActivityMonitor());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTurnAbortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);
  const heardAudioRef = useRef(false);
  const lastUsefulSoundAtRef = useRef(0);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages]
  );
  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages]
  );
  const turns = useMemo(() => {
    const grouped: Array<{ user?: ConversationMessage; assistant?: ConversationMessage }> = [];
    for (let index = 0; index < messages.length; index += 2) {
      grouped.push({
        user: messages[index],
        assistant: messages[index + 1]
      });
    }
    return grouped.reverse();
  }, [messages]);
  const usesBrowserSpeech =
    (settings.backend === "codex-cli" || settings.backend === "gemini-cli") &&
    settings.transcriptionMode === "browser";
  const usesRecordedAudio =
    settings.backend === "openai" ||
    ((settings.backend === "codex-cli" || settings.backend === "gemini-cli") &&
      settings.transcriptionMode !== "browser");

  function speakBrowserSummary(summary: string) {
    setUiState("speaking");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(summary);
    speechUtteranceRef.current = utterance;
    utterance.volume = muted ? 0 : volume;
    utterance.rate = 0.98;
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      setUiState("idle");
    };
    utterance.onerror = () => {
      speechUtteranceRef.current = null;
      setUiState("idle");
    };
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    getHealth()
      .then((health) => {
        setSettings(health.settings);
        setHasOpenAiKey(health.hasOpenAiKey);
        setHasGeminiCli(health.hasGeminiCli);
        setHasCodexCli(health.hasCodexCli);
        setUiState("idle");
        if (!health.hasCodexCli) {
          setError("Codex CLI is not installed. Run npm install -g @openai/codex, then restart the server.");
        }
      })
      .catch((err: unknown) => {
        setUiState("error");
        setError(err instanceof Error ? err.message : "Could not reach the local server.");
      });
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [muted, volume, audioUrl]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Voice Command",
        artist: "Local Voice Assistant",
        album: "Codex CLI"
      });
    }
    navigator.mediaSession.playbackState =
      uiState === "recording" || uiState === "thinking" ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => {
      if (uiState === "idle" || uiState === "error") void startRecording();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (uiState === "recording") void stopRecording();
      if (uiState === "thinking") void cancelActiveTurn();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      if (uiState === "recording") void stopRecording();
      if (uiState === "thinking") void cancelActiveTurn();
    });

    return () => {
      navigator.mediaSession?.setActionHandler("play", null);
      navigator.mediaSession?.setActionHandler("pause", null);
      navigator.mediaSession?.setActionHandler("stop", null);
    };
  }, [uiState, settings.backend, settings.transcriptionMode, liveTranscript, messages, typedPrompt]);

  useEffect(() => {
    if (
      uiState !== "recording" ||
      !usesBrowserSpeech ||
      !liveTranscript.trim() ||
      stoppingRef.current
    ) {
      setAutoStopRemaining(0);
      return;
    }

    const startedAt = Date.now();
    setAutoStopRemaining(AUTO_STOP_AFTER_MS);
    const interval = window.setInterval(() => {
      setAutoStopRemaining(Math.max(0, AUTO_STOP_AFTER_MS - (Date.now() - startedAt)));
    }, 100);
    const timeout = window.setTimeout(() => {
      if (!stoppingRef.current) void stopRecording();
    }, AUTO_STOP_AFTER_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [liveTranscript, uiState, usesBrowserSpeech]);

  useEffect(() => {
    if (uiState !== "recording" || !usesRecordedAudio || stoppingRef.current) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!heardAudioRef.current || stoppingRef.current) {
        setAutoStopRemaining(0);
        return;
      }

      const elapsed = Date.now() - lastUsefulSoundAtRef.current;
      const remaining = Math.max(0, AUTO_STOP_AFTER_MS - elapsed);
      setAutoStopRemaining(remaining);

      if (elapsed >= AUTO_STOP_AFTER_MS) {
        void stopRecording();
      }
    }, 120);

    return () => window.clearInterval(interval);
  }, [uiState, usesRecordedAudio]);

  async function startRecording() {
    setError("");
    setLiveTranscript("");
    setMicLevel(0);
    setAutoStopRemaining(0);
    stoppingRef.current = false;
    heardAudioRef.current = false;
    lastUsefulSoundAtRef.current = 0;
    setUiState("recording");
    try {
      await micMonitorRef.current.start((level) => {
        setMicLevel(level);
        if (level > 0.08) {
          heardAudioRef.current = true;
          lastUsefulSoundAtRef.current = Date.now();
        }
      });

      if (usesBrowserSpeech) {
        recognizerRef.current = new PushToTalkSpeechRecognizer();
        recognizerRef.current.start({
          onTranscript: setLiveTranscript,
          onError: setError,
          language: settings.speechLanguage
        });
      } else {
        await recorderRef.current.start();
      }
    } catch (err) {
      micMonitorRef.current.stop();
      setUiState("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was blocked. Allow microphone access for 127.0.0.1, then refresh the page."
          : err instanceof Error
            ? err.message
            : "Microphone access failed. Check your browser permission and try again."
      );
    }
  }

  async function stopRecording() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setUiState("thinking");
    setError("");
    micMonitorRef.current.stop();
    setMicLevel(0);
    setAutoStopRemaining(0);
    try {
      if (usesBrowserSpeech) {
        const transcript = ((await recognizerRef.current?.stop()) ?? liveTranscript).trim();
        if (!transcript) {
          throw new Error(
            "I did not catch any words from browser speech recognition. Try Gemini audio transcription in settings, or use the typed fallback below."
          );
        }
        activeTurnAbortRef.current = new AbortController();
        const turn = await sendTextTurn({
          transcript,
          history: messages,
          settings,
          signal: activeTurnAbortRef.current.signal
        });
        activeTurnAbortRef.current = null;

        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl("");
        setSpokenSummary(turn.spokenSummary);
        setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);

        if (!muted) {
          speakBrowserSummary(turn.spokenSummary);
        } else {
          setUiState("idle");
        }
        return;
      }

      const recording = await recorderRef.current.stop();
      if (recording.durationMs < 500 || recording.blob.size < 1000) {
        throw new Error("That recording was too short. Hold the mic for a moment and try again.");
      }

      if (settings.backend === "codex-cli" || settings.backend === "gemini-cli") {
        activeTurnAbortRef.current = new AbortController();
        const turn = await sendAudioTextTurn({
          audio: recording.blob,
          history: messages,
          settings,
          signal: activeTurnAbortRef.current.signal
        });
        activeTurnAbortRef.current = null;

        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl("");
        setSpokenSummary(turn.spokenSummary);
        setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);

        if (!muted) {
          speakBrowserSummary(turn.spokenSummary);
        } else {
          setUiState("idle");
        }
        return;
      }

      const turn = await sendVoiceTurn({
        audio: recording.blob,
        history: messages,
        settings
      });

      const nextUrl = audioUrlFromResponse(turn);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(nextUrl);
      setSpokenSummary(turn.spokenSummary);
      setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);

      if (!muted) {
        setUiState("speaking");
        queueMicrotask(() => {
          audioRef.current?.play().catch(() => setUiState("idle"));
        });
      } else {
        setUiState("idle");
      }
    } catch (err) {
      activeTurnAbortRef.current = null;
      setUiState("error");
      setError(err instanceof Error ? err.message : "Voice turn failed. Please try again.");
    } finally {
      stoppingRef.current = false;
    }
  }

  function handlePrimaryControl() {
    if (uiState === "recording") {
      void stopRecording();
      return;
    }
    if (uiState === "idle" || uiState === "error") {
      void startRecording();
    }
  }

  async function sendTypedPrompt() {
    const transcript = typedPrompt.trim();
    if (!transcript) return;

    setUiState("thinking");
    setError("");
    try {
      activeTurnAbortRef.current = new AbortController();
      const turn = await sendTextTurn({
        transcript,
        history: messages,
        settings,
        signal: activeTurnAbortRef.current.signal
      });
      activeTurnAbortRef.current = null;
      setTypedPrompt("");
      setLiveTranscript("");
      setSpokenSummary(turn.spokenSummary);
      setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);

      if (!muted) {
        speakBrowserSummary(turn.spokenSummary);
      } else {
        setUiState("idle");
      }
    } catch (err) {
      activeTurnAbortRef.current = null;
      setUiState("error");
      setError(err instanceof Error ? err.message : "Text turn failed. Please try again.");
    }
  }

  async function cancelActiveTurn() {
    activeTurnAbortRef.current?.abort();
    activeTurnAbortRef.current = null;
    micMonitorRef.current.stop();
    window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
    setMicLevel(0);
    setAutoStopRemaining(0);
    stoppingRef.current = false;
    try {
      await cancelTurn();
    } catch {
      // The local request may already be gone; the UI can still return to idle.
    }
    setUiState("idle");
    setError("Instruction stopped.");
  }

  function replayAudio() {
    if ((settings.backend === "gemini-cli" || settings.backend === "codex-cli") && spokenSummary) {
      speakBrowserSummary(spokenSummary);
      return;
    }
    if (!audioRef.current) return;
    setUiState("speaking");
    audioRef.current.currentTime = 0;
    void audioRef.current.play();
  }

  function stopAudio() {
    if (settings.backend === "gemini-cli" || settings.backend === "codex-cli") {
      window.speechSynthesis.cancel();
      speechUtteranceRef.current = null;
      setUiState("idle");
      return;
    }
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setUiState("idle");
  }

  function newChat() {
    setMessages([]);
    setSpokenSummary("");
    setError("");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    setLiveTranscript("");
    setMicLevel(0);
    setAutoStopRemaining(0);
    stoppingRef.current = false;
    activeTurnAbortRef.current?.abort();
    activeTurnAbortRef.current = null;
    window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
    micMonitorRef.current.stop();
    setUiState("idle");
  }

  const isBusy = uiState === "thinking" || uiState === "speaking" || uiState === "loading";
  const needsOpenAiKey =
    (settings.backend === "openai" || settings.transcriptionMode === "openai-cloud") &&
    !hasOpenAiKey;
  const needsSpeechRecognition = usesBrowserSpeech && !PushToTalkSpeechRecognizer.isSupported();
  const needsCodexCli = settings.backend === "codex-cli" && !hasCodexCli;
  const needsGeminiCli =
    (settings.backend === "gemini-cli" || settings.transcriptionMode === "gemini-cli-audio") &&
    !hasGeminiCli;
  const primaryDisabled =
    isBusy ||
    (needsOpenAiKey && uiState !== "error") ||
    needsSpeechRecognition ||
    needsCodexCli ||
    needsGeminiCli;
  const backendLabel =
    settings.backend === "codex-cli"
      ? "Codex CLI"
      : settings.backend === "gemini-cli"
        ? "Gemini CLI"
        : "OpenAI cloud voice";

  return (
    <main className="shell">
      <section className="assistant-surface">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Voice Assistant</p>
            <h1>Talk, then hear the short version.</h1>
          </div>
          <div className="toolbar">
            <button className="icon-button" onClick={newChat} title="New chat" type="button">
              <RotateCcw size={20} />
            </button>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen((open) => !open)}
              title="Settings"
              type="button"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <div className={`talk-zone ${uiState}`}>
          <div className="status-pill">
            <span className="status-dot" />
            {uiState === "thinking" ? `${backendLabel} thinking` : statusCopy(uiState)}
          </div>
          <div
            className="mic-visual"
            style={{ "--mic-level": String(micLevel) } as CSSProperties}
          >
            <button
              aria-label={uiState === "recording" ? "Stop recording" : "Start recording"}
              className="talk-button"
              disabled={primaryDisabled}
              onClick={handlePrimaryControl}
              type="button"
            >
              {uiState === "thinking" ? (
                <Terminal size={42} />
              ) : uiState === "recording" ? (
                <MicOff size={42} />
              ) : (
                <Mic size={42} />
              )}
            </button>
            <div className="mic-meter" aria-hidden="true">
              <span />
            </div>
          </div>
          <p className="talk-hint">
            {uiState === "recording"
              ? micLevel > 0.08
                ? usesRecordedAudio
                  ? "Mic is receiving sound. I will send the audio after you pause."
                  : "Mic is receiving sound. Tap again when you are done."
                : "Listening. Speak now, and watch the activity bar."
              : uiState === "thinking"
                ? `${backendLabel} is working on your instruction.`
                : settings.backend === "codex-cli"
                  ? usesBrowserSpeech
                    ? "Press to dictate a project change with browser speech."
                    : "Press to dictate a project change with higher-quality audio transcription."
                  : settings.backend === "gemini-cli"
                    ? usesBrowserSpeech
                      ? "Press to speak. Uses Gemini CLI plus browser voice."
                      : "Press to speak. Uses Gemini audio transcription."
                    : "Press to speak. Uses OpenAI cloud voice."}
          </p>
          {uiState === "recording" && autoStopRemaining > 0 ? (
            <p className="auto-stop-hint">
              Auto-stops in {(autoStopRemaining / 1000).toFixed(1)}s after your last words.
            </p>
          ) : null}
          {uiState === "recording" ? (
            <button className="danger-button" onClick={() => void stopRecording()} type="button">
              Stop and send
            </button>
          ) : null}
          {uiState === "thinking" ? (
            <button className="danger-button" onClick={() => void cancelActiveTurn()} type="button">
              Stop instruction
            </button>
          ) : null}
        </div>

        {needsCodexCli ? (
          <div className="notice">Codex mode needs Codex CLI on PATH.</div>
        ) : null}
        {needsGeminiCli ? (
          <div className="notice">
            Gemini audio transcription needs Gemini CLI installed and signed in.
          </div>
        ) : null}
        {needsOpenAiKey ? (
          <div className="notice">OpenAI mode needs OPENAI_API_KEY in .env.</div>
        ) : null}
        {needsSpeechRecognition ? (
          <div className="notice">
            Browser speech recognition is not available here. Switch transcription to Gemini audio.
          </div>
        ) : null}
        {settings.backend === "codex-cli" && !messages.length ? (
          <div className="setup-note">
            Codex mode sends dictated instructions to <code>codex exec</code> in the workspace.
            It can edit files, so speak project-change requests deliberately.
          </div>
        ) : null}
        {settings.backend === "gemini-cli" && !messages.length ? (
          <div className="setup-note">
            First time using Gemini mode? Run <code>npm run gemini:login</code> in this app folder,
            choose Sign in with Google, then restart the server.
          </div>
        ) : null}
        {error ? <div className="notice">{error}</div> : null}

        <div className="panes">
          <section className="panel transcript-panel">
            <div className="panel-heading">
              <Mic size={18} />
              <h2>Transcript</h2>
            </div>
            <p>
              {liveTranscript ||
                lastUserMessage?.content ||
                "Your words will appear here after the first turn."}
            </p>
            {settings.backend === "gemini-cli" || settings.backend === "codex-cli" ? (
              <div className="typed-fallback">
                <label>
                  Type instead
                  <textarea
                    onChange={(event) => setTypedPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        void sendTypedPrompt();
                      }
                    }}
                    placeholder={
                      settings.backend === "codex-cli"
                        ? "Type a project-change request for Codex here."
                        : "If the browser speech recognizer stays blank, type your message here."
                    }
                    rows={3}
                    value={typedPrompt}
                  />
                </label>
                <button
                  className="text-send-button"
                  disabled={!typedPrompt.trim() || isBusy}
                  onClick={() => void sendTypedPrompt()}
                  type="button"
                >
                  {settings.backend === "codex-cli" ? "Send to Codex" : "Send text"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel answer-panel">
            <div className="panel-heading">
              <Bot size={18} />
              <h2>Full response</h2>
            </div>
            {turns.length ? (
              <div className="response-history">
                {turns.map((turn) => (
                  <article className="response-turn" key={turn.assistant?.id ?? turn.user?.id}>
                    {turn.user ? <p className="turn-user">{turn.user.content}</p> : null}
                    {turn.assistant ? <p>{turn.assistant.content}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p>{lastAssistantMessage?.content || "The complete answer will stay readable here."}</p>
            )}
          </section>
        </div>

        <section className="audio-strip">
          <div>
            <p className="eyebrow">Spoken summary · AI-generated voice</p>
            <p>
              {spokenSummary ||
                (settings.backend === "gemini-cli"
                  ? "Gemini mode uses your browser voice to read the summary."
                  : settings.backend === "codex-cli"
                    ? "Codex mode reads a short summary after the local agent finishes."
                  : "After each turn, only the brief summary is read out loud.")}
            </p>
          </div>
          <div className="audio-controls">
            <button
              className="icon-button"
              disabled={!audioUrl && !spokenSummary}
              onClick={replayAudio}
              title="Replay"
            >
              <Play size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!audioUrl && !spokenSummary}
              onClick={stopAudio}
              title="Stop"
            >
              <Square size={18} />
            </button>
            <button className="icon-button" onClick={() => setMuted((value) => !value)} title="Mute">
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              aria-label="Volume"
              max="1"
              min="0"
              onChange={(event) => setVolume(Number(event.target.value))}
              step="0.05"
              type="range"
              value={volume}
            />
          </div>
          {audioUrl ? (
            <audio
              ref={audioRef}
              onEnded={() => setUiState("idle")}
              onPause={() => {
                if (uiState === "speaking") setUiState("idle");
              }}
              src={audioUrl}
            />
          ) : null}
        </section>
      </section>

      <aside className={`settings-drawer ${settingsOpen ? "open" : ""}`}>
        <div className="panel-heading">
          <Settings size={18} />
          <h2>Settings</h2>
        </div>
        <label>
          Backend
          <select
            value={settings.backend}
            onChange={(event) => {
              const backend = event.target.value as AssistantSettings["backend"];
              setSettings({
                ...settings,
                backend,
                transcriptionMode:
                  backend === "openai"
                    ? "openai-cloud"
                    : settings.transcriptionMode === "openai-cloud"
                      ? "gemini-cli-audio"
                      : settings.transcriptionMode,
                assistantModel:
                  backend !== "openai" && settings.assistantModel === "gpt-5-mini"
                    ? "auto"
                    : settings.assistantModel
              });
            }}
          >
            <option value="codex-cli">Codex CLI project mode</option>
            <option value="gemini-cli">Gemini CLI subscription mode</option>
            <option value="openai">OpenAI cloud voice mode</option>
          </select>
        </label>
        {settings.backend !== "openai" ? (
          <label>
            Transcription
            <select
              value={settings.transcriptionMode}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  transcriptionMode: event.target.value as AssistantSettings["transcriptionMode"],
                  transcribeModel:
                    event.target.value === "gemini-cli-audio" &&
                    settings.transcribeModel === "gpt-4o-mini-transcribe"
                      ? "auto"
                      : event.target.value === "openai-cloud" && settings.transcribeModel === "auto"
                        ? "gpt-4o-mini-transcribe"
                        : settings.transcribeModel
                })
              }
            >
              <option value="browser">Browser live speech</option>
              <option value="gemini-cli-audio">Gemini audio transcription (experimental)</option>
              <option value="openai-cloud">OpenAI cloud transcription</option>
            </select>
          </label>
        ) : null}
        {usesBrowserSpeech ? (
          <label>
            Speech language
            <select
              value={settings.speechLanguage}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  speechLanguage: event.target.value
                })
              }
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-CO">Spanish (Colombia)</option>
              <option value="es-US">Spanish (US)</option>
              <option value="auto">Browser default</option>
            </select>
          </label>
        ) : null}
        {settings.backend === "codex-cli" ? (
          <label>
            Codex mode
            <select
              value={settings.codexMode}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  codexMode: event.target.value as AssistantSettings["codexMode"]
                })
              }
            >
              <option value="execute">Execute changes</option>
              <option value="plan">Plan only</option>
            </select>
          </label>
        ) : null}
        <label>
          Voice
          <select
            value={settings.voice}
            onChange={(event) => setSettings({ ...settings, voice: event.target.value })}
          >
            <option value="marin">Marin</option>
            <option value="cedar">Cedar</option>
            <option value="alloy">Alloy</option>
            <option value="verse">Verse</option>
          </select>
        </label>
        <label>
          Summary words
          <input
            max="100"
            min="15"
            type="number"
            value={settings.summaryWords}
            onChange={(event) =>
              setSettings({ ...settings, summaryWords: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Assistant model
          <input
            placeholder={settings.backend === "openai" ? "gpt-5-mini" : "auto"}
            value={settings.assistantModel}
            onChange={(event) => setSettings({ ...settings, assistantModel: event.target.value })}
          />
        </label>
        <label>
          Assistant style
          <textarea
            rows={6}
            value={settings.assistantStyle}
            onChange={(event) => setSettings({ ...settings, assistantStyle: event.target.value })}
          />
        </label>
        <div className="future-box">
          <Pause size={18} />
          <p>Wake phrase, always-listen, Home Assistant, and Codex bridges are reserved as adapters.</p>
        </div>
      </aside>
    </main>
  );
}
