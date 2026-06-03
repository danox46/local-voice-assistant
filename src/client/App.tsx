import {
  Bot,
  ClipboardList,
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
import type {
  AssistantSettings,
  BackgroundSession,
  ConversationMessage,
  PlannerPrompt,
  TextTurnResponse,
  VoiceTurnResponse
} from "../shared/types";
import {
  archiveSession,
  cancelSession,
  cancelTurn,
  createSession,
  focusSession,
  getHealth,
  getPlannerSession,
  inspectSession,
  listSessions,
  resetPlannerSession,
  sendAudioTextTurn,
  sendTextTurn,
  sendVoiceTurn
} from "./api";
import { MicActivityMonitor, PushToTalkRecorder, PushToTalkSpeechRecognizer } from "./recorder";

type UiState = "loading" | "idle" | "recording" | "thinking" | "speaking" | "error";
const AUTO_STOP_AFTER_MS = 3500;
const WAKE_PHRASE = "tensoon";

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

function sessionStatusCopy(session: BackgroundSession) {
  if (session.status === "queued") return "Queued";
  if (session.status === "running") return "Running";
  if (session.status === "done") return "Done";
  if (session.status === "blocked") return "Blocked";
  if (session.status === "failed") return "Failed";
  return "Cancelled";
}

function sessionSummary(session: BackgroundSession) {
  return (
    session.report.summary ||
    (session.status === "running" ? "Worker is still running." : "No summary yet.")
  );
}

function sessionNeedsAttention(session: BackgroundSession) {
  return session.supervision.shouldNotify || session.supervision.level === "needs-user";
}

export function splitSpeechIntoChunks(text: string, maxChunkLength = 180) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()) ?? [
    clean
  ];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxChunkLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const words = sentence.split(/\s+/);
      let phrase = "";
      for (const word of words) {
        const nextPhrase = phrase ? `${phrase} ${word}` : word;
        if (nextPhrase.length > maxChunkLength && phrase) {
          chunks.push(phrase);
          phrase = word;
        } else {
          phrase = nextPhrase;
        }
      }
      if (phrase) chunks.push(phrase);
      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChunkLength && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function containsWakePhrase(transcript: string, wakePhrase = WAKE_PHRASE) {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized.replace(/\s+/g, "");
  const expected = wakePhrase.toLowerCase().replace(/\s+/g, "");
  const likelyVariants = [expected, "tension", "tensoon", "tenson", "tensun", "tenzone"];
  return likelyVariants.some((variant) => compact.includes(variant)) || normalized.includes("ten soon");
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
  const [sessions, setSessions] = useState<BackgroundSession[]>([]);
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [wakeStatus, setWakeStatus] = useState<"off" | "listening" | "heard" | "error">("off");
  const [plannerPrompt, setPlannerPrompt] = useState<PlannerPrompt | null>(null);
  const [sessionInspectionNotes, setSessionInspectionNotes] = useState<Record<string, string>>({});
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);

  const recorderRef = useRef(new PushToTalkRecorder());
  const recognizerRef = useRef<PushToTalkSpeechRecognizer | null>(null);
  const wakeRecognizerRef = useRef<PushToTalkSpeechRecognizer | null>(null);
  const wakeRestartTimerRef = useRef<number | null>(null);
  const micMonitorRef = useRef(new MicActivityMonitor());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTurnAbortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);
  const heardAudioRef = useRef(false);
  const lastUsefulSoundAtRef = useRef(0);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const speechActiveRef = useRef(false);
  const speechTokenRef = useRef(0);
  const speechTimeoutRef = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const uiStateRef = useRef(uiState);
  const wakeEnabledRef = useRef(wakeEnabled);
  const knownSessionStatusesRef = useRef<Map<string, BackgroundSession["status"]>>(new Map());
  const sessionsHydratedRef = useRef(false);

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
  const visibleSessions = sessions.filter((session) => showArchivedSessions || !session.archivedAt);
  const focusedSession = sessions.find((session) => session.focused && !session.archivedAt);
  const runningSessions = visibleSessions.filter(
    (session) => session.status === "queued" || session.status === "running"
  );
  const attentionSessions = visibleSessions.filter(
    (session) => sessionNeedsAttention(session)
  );
  const completedSessions = visibleSessions.filter((session) => session.status === "done");
  const canUseWakePhrase = PushToTalkSpeechRecognizer.isSupported();
  const wakeIsArmed = wakeEnabled && canUseWakePhrase && wakeStatus === "listening";

  function applyTextTurn(turn: TextTurnResponse) {
    setSpokenSummary(turn.spokenSummary);
    setPlannerPrompt(turn.plannerPrompt ?? null);
    setMessages((current) =>
      turn.plannerSession?.messages ?? [...current, turn.userMessage, turn.assistantMessage]
    );
  }

  function answerPlannerQuestion(question: string) {
    setTypedPrompt((current) => {
      const prefix = `Answering: ${question}`;
      return current.trim() ? `${current.trim()}\n${prefix}\n` : `${prefix}\n`;
    });
  }

  function clearWakeRestartTimer() {
    if (!wakeRestartTimerRef.current) return;
    window.clearTimeout(wakeRestartTimerRef.current);
    wakeRestartTimerRef.current = null;
  }

  function stopWakeListener() {
    clearWakeRestartTimer();
    const recognizer = wakeRecognizerRef.current;
    wakeRecognizerRef.current = null;
    void recognizer?.stop();
  }

  function shouldArmWakeListener() {
    return (
      wakeEnabledRef.current &&
      PushToTalkSpeechRecognizer.isSupported() &&
      (uiStateRef.current === "idle" || uiStateRef.current === "error")
    );
  }

  function scheduleWakeRestart() {
    clearWakeRestartTimer();
    if (!shouldArmWakeListener()) return;
    wakeRestartTimerRef.current = window.setTimeout(() => {
      wakeRestartTimerRef.current = null;
      startWakeListener();
    }, 700);
  }

  function triggerWakePhrase(transcript: string) {
    if (!shouldArmWakeListener()) return;
    setWakeStatus("heard");
    stopWakeListener();
    setLiveTranscript(transcript);
    clearBrowserPlaybackQueue();
    window.setTimeout(() => {
      if (uiStateRef.current === "idle" || uiStateRef.current === "error") {
        void startRecording();
      }
    }, 150);
  }

  function startWakeListener() {
    if (!shouldArmWakeListener() || wakeRecognizerRef.current) return;
    try {
      const recognizer = new PushToTalkSpeechRecognizer();
      wakeRecognizerRef.current = recognizer;
      recognizer.start({
        language: settings.speechLanguage,
        onTranscript: (transcript) => {
          if (containsWakePhrase(transcript)) {
            triggerWakePhrase(transcript);
          }
        },
        onError: () => {
          wakeRecognizerRef.current = null;
          setWakeStatus("error");
          scheduleWakeRestart();
        },
        onEnd: () => {
          wakeRecognizerRef.current = null;
          scheduleWakeRestart();
        }
      });
      setWakeStatus("listening");
    } catch {
      wakeRecognizerRef.current = null;
      setWakeStatus("error");
    }
  }

  async function refreshSessions() {
    try {
      const nextSessions = await listSessions();
      const knownStatuses = knownSessionStatusesRef.current;
      const completedSession = nextSessions.find((session) => {
        const previousStatus = knownStatuses.get(session.id);
        const wasActive = previousStatus === "queued" || previousStatus === "running";
        const nowNeedsReport = session.supervision.shouldNotify;
        return sessionsHydratedRef.current && wasActive && nowNeedsReport;
      });

      knownSessionStatusesRef.current = new Map(
        nextSessions.map((session) => [session.id, session.status])
      );
      sessionsHydratedRef.current = true;
      setSessions(nextSessions);

      if (completedSession) {
        const summary = [
          `Worker update: ${completedSession.title} is ${sessionStatusCopy(completedSession).toLowerCase()}.`,
          sessionSummary(completedSession),
          completedSession.report.blockers &&
          completedSession.report.blockers !== "None reported."
            ? `Blocker: ${completedSession.report.blockers}`
            : "",
          completedSession.report.next ? `Next: ${completedSession.report.next}` : ""
        ]
          .filter(Boolean)
          .join(" ");
        setSpokenSummary(summary);
        enqueueBrowserSummary(summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load worker sessions.");
    }
  }

  function playNextBrowserSummary() {
    if (speechActiveRef.current) return;
    const nextSummary = speechQueueRef.current.shift();
    if (!nextSummary) {
      setUiState((current) => (current === "speaking" ? "idle" : current));
      return;
    }

    const token = ++speechTokenRef.current;
    speechActiveRef.current = true;
    setUiState("speaking");
    const utterance = new SpeechSynthesisUtterance(nextSummary);
    speechUtteranceRef.current = utterance;
    utterance.volume = mutedRef.current ? 0 : volumeRef.current;
    utterance.rate = 0.98;
    const finish = () => {
      if (token !== speechTokenRef.current) return;
      if (speechTimeoutRef.current) {
        window.clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      speechUtteranceRef.current = null;
      speechActiveRef.current = false;
      playNextBrowserSummary();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    const estimatedMs = Math.max(4500, nextSummary.split(/\s+/).length * 650);
    speechTimeoutRef.current = window.setTimeout(finish, estimatedMs);
  }

  function enqueueBrowserSummary(summary: string, options: { replace?: boolean } = {}) {
    const cleanSummary = summary.trim();
    if (!cleanSummary || mutedRef.current) return;

    if (options.replace) {
      speechQueueRef.current = [];
      speechActiveRef.current = false;
      speechUtteranceRef.current = null;
      speechTokenRef.current += 1;
      window.speechSynthesis.cancel();
    }

    speechQueueRef.current.push(...splitSpeechIntoChunks(cleanSummary));
    playNextBrowserSummary();
  }

  function clearBrowserPlaybackQueue() {
    speechQueueRef.current = [];
    speechActiveRef.current = false;
    speechUtteranceRef.current = null;
    speechTokenRef.current += 1;
    if (speechTimeoutRef.current) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    window.speechSynthesis.cancel();
    setUiState((current) => (current === "speaking" ? "idle" : current));
  }

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    wakeEnabledRef.current = wakeEnabled;
  }, [wakeEnabled]);

  useEffect(() => {
    if (!wakeEnabled) {
      stopWakeListener();
      setWakeStatus("off");
      return;
    }

    if (!canUseWakePhrase) {
      setWakeStatus("error");
      return;
    }

    if (uiState === "idle" || uiState === "error") {
      startWakeListener();
      return;
    }

    stopWakeListener();
    setWakeStatus("off");
  }, [canUseWakePhrase, settings.speechLanguage, uiState, wakeEnabled]);

  useEffect(() => {
    return () => stopWakeListener();
  }, []);

  useEffect(() => {
    getHealth()
      .then(async (health) => {
        setSettings(health.settings);
        setHasOpenAiKey(health.hasOpenAiKey);
        setHasGeminiCli(health.hasGeminiCli);
        setHasCodexCli(health.hasCodexCli);
        const plannerSession = await getPlannerSession();
        setMessages(plannerSession.messages);
        if (plannerSession.lastError) {
          setError(plannerSession.lastError);
        }
        setUiState("idle");
        void refreshSessions();
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
    const interval = window.setInterval(() => {
      void refreshSessions();
    }, 4000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
    mutedRef.current = muted;
    volumeRef.current = volume;
    if (muted) {
      clearBrowserPlaybackQueue();
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
    stopWakeListener();
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
        applyTextTurn(turn);
        void refreshSessions();

        if (!muted) {
          enqueueBrowserSummary(turn.spokenSummary);
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
        applyTextTurn(turn);
        void refreshSessions();

        if (!muted) {
          enqueueBrowserSummary(turn.spokenSummary);
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
      setPlannerPrompt(turn.plannerPrompt ?? null);
      setMessages((current) =>
        turn.plannerSession?.messages ?? [...current, turn.userMessage, turn.assistantMessage]
      );
      void refreshSessions();

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
      applyTextTurn(turn);
      void refreshSessions();

      if (!muted) {
        enqueueBrowserSummary(turn.spokenSummary);
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
    clearBrowserPlaybackQueue();
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
      enqueueBrowserSummary(spokenSummary, { replace: true });
      return;
    }
    if (!audioRef.current) return;
    setUiState("speaking");
    audioRef.current.currentTime = 0;
    void audioRef.current.play();
  }

  function stopAudio() {
    if (settings.backend === "gemini-cli" || settings.backend === "codex-cli") {
      clearBrowserPlaybackQueue();
      return;
    }
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setUiState("idle");
  }

  async function stopSession(session: BackgroundSession) {
    try {
      await cancelSession(session.id);
      await refreshSessions();
      setSpokenSummary(`${session.title} was cancelled.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the worker.");
    }
  }

  function speakSession(session: BackgroundSession) {
    const summary = [
      `${session.title} is ${sessionStatusCopy(session).toLowerCase()}.`,
      sessionSummary(session),
      session.report.blockers && session.report.blockers !== "None reported."
        ? `Blocker: ${session.report.blockers}`
        : "",
      session.report.next ? `Next: ${session.report.next}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    setSpokenSummary(summary);
    enqueueBrowserSummary(summary);
  }

  async function continueSession(session: BackgroundSession) {
    const nextPrompt = [
      `Continue from worker "${session.title}".`,
      `Previous status: ${session.status}.`,
      `Summary: ${session.report.summary}`,
      `Changed: ${session.report.changed}`,
      `Verified: ${session.report.verified}`,
      `Blockers: ${session.report.blockers}`,
      `Next step: ${session.report.next || "Choose the best next step and proceed."}`
    ].join("\n");

    try {
      await createSession({
        title: `Continue ${session.title}`,
        prompt: nextPrompt,
        mode: settings.codexMode
      });
      await refreshSessions();
      const summary = `Started a follow-up worker for ${session.title}.`;
      setSpokenSummary(summary);
      enqueueBrowserSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the follow-up worker.");
    }
  }

  async function inspectSessionQuietly(session: BackgroundSession) {
    try {
      const inspection = await inspectSession(session.id);
      setSessionInspectionNotes((current) => ({
        ...current,
        [session.id]: inspection.summary
      }));
      if (inspection.issueFound && inspection.userNeeded) {
        const summary = `Inspection found a user-needed blocker for ${session.title}. ${inspection.summary}`;
        setSpokenSummary(summary);
        enqueueBrowserSummary(summary);
      } else if (inspection.issueFound) {
        setSpokenSummary(`Inspection found an agent-actionable issue for ${session.title}.`);
      } else {
        setSpokenSummary(`Inspection found no issue for ${session.title}.`);
      }
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect the worker session.");
    }
  }

  async function focusWorkerSession(session: BackgroundSession) {
    try {
      await focusSession(session.id);
      await refreshSessions();
      const summary = `${session.title} is now the focused worker context.`;
      setSpokenSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not focus the worker session.");
    }
  }

  async function archiveWorkerSession(session: BackgroundSession) {
    try {
      await archiveSession(session.id);
      await refreshSessions();
      setSpokenSummary(`${session.title} was archived.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive the worker session.");
    }
  }

  async function newChat() {
    try {
      const plannerSession = await resetPlannerSession();
      setMessages(plannerSession.messages);
      setError("");
      setPlannerPrompt(null);
    } catch (err) {
      setMessages([]);
      setError(err instanceof Error ? err.message : "Could not reset planner session.");
    }
    setSpokenSummary("");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    setLiveTranscript("");
    setMicLevel(0);
    setAutoStopRemaining(0);
    stoppingRef.current = false;
    activeTurnAbortRef.current?.abort();
    activeTurnAbortRef.current = null;
    clearBrowserPlaybackQueue();
    stopWakeListener();
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
            <h1>Plan by voice. Delegate the work.</h1>
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
            {uiState === "thinking"
              ? `${backendLabel} thinking`
              : wakeIsArmed && uiState === "idle"
                ? "Wake phrase armed"
                : statusCopy(uiState)}
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
                    ? "Press to talk with the planning agent. Actionable work becomes background workers."
                    : "Press to talk with the planning agent using recorded audio transcription."
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
          {uiState === "idle" && wakeEnabled ? (
            <p className={`wake-hint ${wakeStatus}`}>
              {wakeIsArmed
                ? `Say "${WAKE_PHRASE}" to start listening.`
                : canUseWakePhrase
                  ? "Wake phrase is waiting for the speech listener."
                  : "Wake phrase needs browser speech recognition support."}
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
            Codex mode now acts as a planning agent. It keeps the main conversation open and hands
            concrete tasks to background workers in the workspace.
          </div>
        ) : null}
        {settings.backend === "gemini-cli" && !messages.length ? (
          <div className="setup-note">
            First time using Gemini mode? Run <code>npm run gemini:login</code> in this app folder,
            choose Sign in with Google, then restart the server.
          </div>
        ) : null}
          {error ? <div className="notice">{error}</div> : null}
        {focusedSession ? (
          <div className="setup-note focused-note">
            Focused worker: <strong>{focusedSession.title}</strong>. Follow-up voice prompts include
            this worker's summary and next step as context.
          </div>
        ) : null}

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

        {plannerPrompt ? (
          <section className="panel planner-panel">
            <div className="panel-heading command-heading">
              <ClipboardList size={18} />
              <div>
                <h2>Planning Questions</h2>
                <p>{plannerPrompt.topic}</p>
              </div>
            </div>
            <div className="planner-question-grid">
              {plannerPrompt.questions.map((question) => (
                <article className="planner-question" key={question.id}>
                  <span>{question.label}</span>
                  <p>{question.question}</p>
                  <small>{question.why}</small>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => answerPlannerQuestion(question.question)}
                  >
                    Answer
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel command-center">
          <div className="panel-heading command-heading">
            <ClipboardList size={18} />
            <div>
              <h2>Worker Sessions</h2>
              <p>
                {runningSessions.length} running · {attentionSessions.length} need attention ·{" "}
                {completedSessions.length} done
              </p>
            </div>
            <button
              className="small-button"
              type="button"
              onClick={() => setShowArchivedSessions((value) => !value)}
            >
              {showArchivedSessions ? "Hide archived" : "Show archived"}
            </button>
          </div>

          {visibleSessions.length ? (
            <div className="session-grid">
              {visibleSessions.map((session) => (
                <article
                  className={`session-card ${session.status} ${session.focused ? "focused" : ""} ${
                    session.archivedAt ? "archived" : ""
                  }`}
                  key={session.id}
                >
                  <div className="session-card-top">
                    <div>
                      <span className="session-status">{sessionStatusCopy(session)}</span>
                      <h3>{session.title}</h3>
                    </div>
                    <span className="session-mode">{session.focused ? "focused" : session.mode}</span>
                  </div>
                  <p>{sessionSummary(session)}</p>
                  {session.report.blockers && session.report.blockers !== "None reported." ? (
                    <p className="session-blocker">{session.report.blockers}</p>
                  ) : null}
                  {session.report.next ? <p className="session-next">{session.report.next}</p> : null}
                  {session.supervision.level !== "normal" ? (
                    <p className={`session-supervision ${session.supervision.level}`}>
                      {session.supervision.userNeeded ? "User needed: " : "Agent note: "}
                      {session.supervision.reason}
                    </p>
                  ) : null}
                  {sessionInspectionNotes[session.id] ? (
                    <p className="session-inspection">{sessionInspectionNotes[session.id]}</p>
                  ) : null}
                  <div className="session-actions">
                    <button className="small-button" type="button" onClick={() => speakSession(session)}>
                      Read
                    </button>
                    <button
                      className="small-button"
                      disabled={Boolean(session.archivedAt)}
                      type="button"
                      onClick={() => void focusWorkerSession(session)}
                    >
                      Focus
                    </button>
                    <button
                      className="small-button"
                      type="button"
                      onClick={() => void inspectSessionQuietly(session)}
                    >
                      Inspect
                    </button>
                    <button
                      className="small-button"
                      disabled={session.status === "queued" || session.status === "running"}
                      type="button"
                      onClick={() => void continueSession(session)}
                    >
                      Continue
                    </button>
                    <button
                      className="small-button"
                      disabled={session.status === "queued" || session.status === "running"}
                      type="button"
                      onClick={() => void archiveWorkerSession(session)}
                    >
                      Archive
                    </button>
                    <button
                      className="small-button danger"
                      disabled={session.status !== "queued" && session.status !== "running"}
                      type="button"
                      onClick={() => void stopSession(session)}
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-sessions">
              No worker sessions yet. Ask for a concrete change and I will start one in the background.
            </p>
          )}
        </section>

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
        <label className="checkbox-label">
          <input
            checked={wakeEnabled}
            disabled={!canUseWakePhrase}
            type="checkbox"
            onChange={(event) => setWakeEnabled(event.target.checked)}
          />
          Wake on "{WAKE_PHRASE}"
        </label>
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
          <p>Wake phrase is local browser speech. Always-listen, Home Assistant, and Codex bridges are reserved as adapters.</p>
        </div>
      </aside>
    </main>
  );
}
