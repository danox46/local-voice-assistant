import crypto from "node:crypto";
import type {
  AssistantSettings,
  BackgroundSession,
  BackgroundSessionMode,
  ConversationMessage,
  TextTurnResponse
} from "../shared/types";
import { spokenSummaryFrom } from "./plannerTurn";
import {
  archiveBackgroundSession,
  cancelBackgroundSession,
  createBackgroundSession,
  focusBackgroundSession,
  getFocusedBackgroundSession,
  inspectBackgroundSession,
  listBackgroundSessions
} from "./sessionManager";

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

function cleanTranscript(transcript: string) {
  return transcript.toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function visibleSessions() {
  return listBackgroundSessions().filter((session) => !session.archivedAt);
}

function latestSession() {
  return visibleSessions()[0];
}

function completedSessions() {
  return visibleSessions().filter((session) => session.status === "done" || session.status === "cancelled");
}

function commandResponse(input: {
  transcript: string;
  answer: string;
  settings: AssistantSettings;
  spokenSummary?: string;
}): TextTurnResponse {
  return {
    userMessage: createMessage("user", input.transcript),
    assistantMessage: createMessage("assistant", input.answer),
    spokenSummary: input.spokenSummary ?? spokenSummaryFrom(input.answer, input.settings),
    settings: input.settings
  };
}

function sessionLabel(session: BackgroundSession) {
  return `${session.title} (${session.status})`;
}

function modeFromSettings(settings: AssistantSettings): BackgroundSessionMode {
  return settings.codexMode === "plan" ? "plan" : "execute";
}

function followUpPrompt(session: BackgroundSession, history: ConversationMessage[], transcript: string) {
  const recentContext = history
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  return [
    "You are a follow-up Codex worker started from the voice command center.",
    "Continue from the focused worker report below. Keep the scope bounded.",
    "Focused worker:",
    `${session.title} (${session.status})`,
    "Report:",
    `Summary: ${session.report.summary || "No summary reported."}`,
    `Changed: ${session.report.changed || "No changes reported."}`,
    `Verified: ${session.report.verified || "No verification reported."}`,
    `Blockers: ${session.report.blockers || "No blockers reported."}`,
    `Next: ${session.report.next || "No next step reported."}`,
    "Recent planning context:",
    recentContext || "(none)",
    "Voice command:",
    transcript
  ].join("\n\n");
}

export function handleSessionCommand(
  transcript: string,
  history: ConversationMessage[],
  settings: AssistantSettings
): TextTurnResponse | undefined {
  const original = transcript.trim();
  const clean = cleanTranscript(transcript);
  if (!clean) return undefined;

  if (/\b(focus|select|switch to)\b/.test(clean) && /\b(latest|last|newest|recent)\b/.test(clean)) {
    const session = latestSession();
    if (!session) {
      return commandResponse({
        transcript: original,
        settings,
        answer: "There are no visible worker sessions to focus yet.",
        spokenSummary: "No worker sessions are available to focus yet."
      });
    }
    const focused = focusBackgroundSession(session.id)!;
    return commandResponse({
      transcript: original,
      settings,
      answer: `Focused worker: ${sessionLabel(focused)}.\n\nFuture voice turns can refer to this as the current worker.`,
      spokenSummary: `Focused ${focused.title}.`
    });
  }

  if (
    /\b(inspect|diagnose|check logs|look at logs|check)\b/.test(clean) &&
    /\b(focused|current|selected|worker|session)\b/.test(clean)
  ) {
    const session = getFocusedBackgroundSession() ?? latestSession();
    if (!session) {
      return commandResponse({
        transcript: original,
        settings,
        answer: "There is no focused or visible worker session to inspect.",
        spokenSummary: "No worker session is available to inspect."
      });
    }
    const inspection = inspectBackgroundSession(session.id);
    if (!inspection) {
      return commandResponse({
        transcript: original,
        settings,
        answer: `I could not inspect ${session.title}; the session is no longer available.`,
        spokenSummary: "That worker is no longer available."
      });
    }
    const answer = [
      `Inspection for ${sessionLabel(session)}: ${inspection.summary}`,
      "",
      inspection.evidence ? `Evidence:\n${inspection.evidence}` : "",
      inspection.userNeeded
        ? "This needs you before a worker can safely continue."
        : inspection.issueFound
          ? "This looks actionable by the agent, so we can continue with a follow-up worker."
          : "No concrete issue was found in the available output."
    ]
      .filter(Boolean)
      .join("\n");
    return commandResponse({
      transcript: original,
      settings,
      answer,
      spokenSummary: inspection.userNeeded
        ? `Inspection found a user-needed blocker: ${inspection.summary}`
        : `Inspection complete. ${inspection.summary}`
    });
  }

  if (/\barchive\b/.test(clean) && /\b(completed|complete|done|finished|cancelled|canceled)\b/.test(clean)) {
    const archived = completedSessions()
      .map((session) => archiveBackgroundSession(session.id))
      .filter(Boolean) as BackgroundSession[];
    const answer = archived.length
      ? `Archived ${archived.length} completed worker${archived.length === 1 ? "" : "s"}:\n${archived
          .map((session) => `- ${sessionLabel(session)}`)
          .join("\n")}`
      : "There are no completed or cancelled visible workers to archive.";
    return commandResponse({
      transcript: original,
      settings,
      answer,
      spokenSummary: archived.length
        ? `Archived ${archived.length} completed worker${archived.length === 1 ? "" : "s"}.`
        : "No completed workers are ready to archive."
    });
  }

  if (
    /\b(cancel|stop)\b/.test(clean) &&
    /\b(focused|current|selected|worker|session)\b/.test(clean)
  ) {
    const session = getFocusedBackgroundSession() ?? latestSession();
    if (!session) {
      return commandResponse({
        transcript: original,
        settings,
        answer: "There is no focused or visible worker session to cancel.",
        spokenSummary: "No worker session is available to cancel."
      });
    }
    const cancelled = cancelBackgroundSession(session.id);
    return commandResponse({
      transcript: original,
      settings,
      answer: cancelled
        ? `Cancelled worker: ${session.title}.`
        : `${session.title} is not running, so there was nothing to cancel.`,
      spokenSummary: cancelled ? `Cancelled ${session.title}.` : `${session.title} is not running.`
    });
  }

  if (
    /\b(continue|resume|retry|follow up|start next)\b/.test(clean) &&
    /\b(focused|current|selected|worker|session)\b/.test(clean)
  ) {
    const session = getFocusedBackgroundSession() ?? latestSession();
    if (!session) {
      return commandResponse({
        transcript: original,
        settings,
        answer: "There is no focused or visible worker session to continue from.",
        spokenSummary: "No worker session is available to continue from."
      });
    }
    const next = createBackgroundSession({
      title: `Continue ${session.title}`.slice(0, 120),
      mode: modeFromSettings(settings),
      prompt: followUpPrompt(session, history, original)
    });
    focusBackgroundSession(next.id);
    const answer = [
      `Started a follow-up worker from ${session.title}.`,
      `New worker: ${next.title} (${next.mode} mode).`,
      "I focused the new worker so future commands can refer to it as the current worker."
    ].join("\n\n");
    return commandResponse({
      transcript: original,
      settings,
      answer,
      spokenSummary: `Started and focused a follow-up worker for ${session.title}.`
    });
  }

  return undefined;
}
