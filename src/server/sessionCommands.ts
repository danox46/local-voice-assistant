import crypto from "node:crypto";
import type {
  AssistantSettings,
  BackgroundSession,
  BackgroundSessionMode,
  ConversationMessage,
  TextTurnResponse
} from "../shared/types";
import { commandCatalogSummary } from "../shared/voiceCommandCatalog";
import { recordActivity } from "./activityFeed";
import { getPlannerSession, resetPlannerSession } from "./plannerSessionStore";
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

function agentActionableBlockedSessions() {
  return visibleSessions().filter((session) => {
    if (session.status !== "blocked" && session.status !== "failed") return false;
    return !session.supervision.userNeeded && session.supervision.level === "auto-actionable";
  });
}

function commandResponse(input: {
  transcript: string;
  answer: string;
  settings: AssistantSettings;
  spokenSummary?: string;
  plannerSession?: TextTurnResponse["plannerSession"];
}): TextTurnResponse {
  return {
    userMessage: createMessage("user", input.transcript),
    assistantMessage: createMessage("assistant", input.answer),
    spokenSummary: input.spokenSummary ?? spokenSummaryFrom(input.answer, input.settings),
    settings: input.settings,
    plannerSession: input.plannerSession
  };
}

function sessionLabel(session: BackgroundSession) {
  return `${session.title} (${session.status})`;
}

function modeFromSettings(settings: AssistantSettings): BackgroundSessionMode {
  return settings.codexMode === "plan" ? "plan" : "execute";
}

function modeName(mode: AssistantSettings["codexMode"]) {
  return mode === "plan" ? "plan-only" : "execute";
}

function modeSettings(settings: AssistantSettings, mode: AssistantSettings["codexMode"]) {
  return {
    ...settings,
    codexMode: mode
  };
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

function plannerRecap(messages: ConversationMessage[]) {
  const turns = messages.reduce(
    (count, message) => count + (message.role === "user" ? 1 : 0),
    0
  );
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");

  if (!messages.length) {
    return {
      answer: "The main planning session is empty. We can start fresh.",
      spokenSummary: "The main planning session is empty."
    };
  }

  return {
    answer: [
      `Main planning session: ${turns} user turn${turns === 1 ? "" : "s"} saved.`,
      latestUser ? `Latest user request: ${latestUser.content}` : "",
      latestAssistant ? `Latest assistant response: ${latestAssistant.content}` : ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    spokenSummary: latestUser
      ? `There are ${turns} saved user turns. Latest request: ${latestUser.content}`
      : `There are ${turns} saved user turns.`
  };
}

export function handleSessionCommand(
  transcript: string,
  history: ConversationMessage[],
  settings: AssistantSettings
): TextTurnResponse | undefined {
  const original = transcript.trim();
  const clean = cleanTranscript(transcript);
  if (!clean) return undefined;

  if (
    /\b(help|commands|what can i say|what can you do|voice commands)\b/.test(clean) &&
    /\b(voice|commands|say|do|help)\b/.test(clean)
  ) {
    const answer = [
      "You can talk normally for planning or brainstorming. For direct cockpit controls, try:",
      "",
      commandCatalogSummary(14)
    ].join("\n");
    recordActivity({
      kind: "system",
      title: "Voice command help requested",
      detail: "The user asked what voice commands are available.",
      severity: "info"
    });
    return commandResponse({
      transcript: original,
      settings,
      answer,
      spokenSummary:
        "You can talk normally for planning. Useful commands include: repeat last response, retry last turn, switch to plan mode, focus the latest worker, inspect the current worker, continue actionable blockers, and start a new chat."
    });
  }

  if (
    /\b(new|fresh|reset|clear|start over)\b/.test(clean) &&
    /\b(chat|conversation|planner|planning session|main session)\b/.test(clean)
  ) {
    const plannerSession = resetPlannerSession();
    recordActivity({
      kind: "system",
      title: "Planner session reset",
      detail: "Voice command cleared the main planning conversation.",
      severity: "warning"
    });
    return commandResponse({
      transcript: original,
      settings,
      plannerSession,
      answer: "Started a fresh planning chat. Worker history and saved reports are still available.",
      spokenSummary: "Started a fresh planning chat."
    });
  }

  if (
    /\b(recap|summarize|summary|resume|catch me up)\b/.test(clean) &&
    /\b(chat|conversation|planner|planning session|main session|where we are)\b/.test(clean)
  ) {
    const plannerSession = getPlannerSession();
    const recap = plannerRecap(plannerSession.messages);
    recordActivity({
      kind: "system",
      title: "Planner recap requested",
      detail: `Voice command requested a recap of ${plannerSession.messages.length} saved messages.`,
      severity: "info"
    });
    return commandResponse({
      transcript: original,
      settings,
      answer: recap.answer,
      spokenSummary: recap.spokenSummary
    });
  }

  if (
    /\b(what|which|current|show|tell me)\b/.test(clean) &&
    /\b(mode|planning mode|execute mode|plan mode)\b/.test(clean)
  ) {
    recordActivity({
      kind: "mode",
      title: "Mode checked",
      detail: `Current Codex mode is ${modeName(settings.codexMode)}.`,
      severity: "info"
    });
    return commandResponse({
      transcript: original,
      settings,
      answer: `Current Codex mode: ${modeName(settings.codexMode)}.\n\nIn plan-only mode, workers inspect and plan without editing. In execute mode, workers may make bounded changes in the configured workspace.`,
      spokenSummary: `Current Codex mode is ${modeName(settings.codexMode)}.`
    });
  }

  if (
    /\b(switch|change|set|use|enable|turn on)\b/.test(clean) &&
    /\b(plan mode|planning mode|plan-only|plan only|read only|read-only)\b/.test(clean)
  ) {
    const nextSettings = modeSettings(settings, "plan");
    recordActivity({
      kind: "mode",
      title: "Plan mode enabled",
      detail: "Voice command switched new Codex workers to plan-only mode.",
      severity: "info"
    });
    return commandResponse({
      transcript: original,
      settings: nextSettings,
      answer: "Switched Codex to plan-only mode.\n\nNew worker sessions will inspect, reason, and propose steps without editing files.",
      spokenSummary: "Switched Codex to plan-only mode."
    });
  }

  if (
    /\b(switch|change|set|use|enable|turn on)\b/.test(clean) &&
    /\b(execute mode|execution mode|make changes|edit files|write files)\b/.test(clean)
  ) {
    const nextSettings = modeSettings(settings, "execute");
    recordActivity({
      kind: "mode",
      title: "Execute mode enabled",
      detail: "Voice command switched new Codex workers to execute mode.",
      severity: "warning"
    });
    return commandResponse({
      transcript: original,
      settings: nextSettings,
      answer: "Switched Codex to execute mode.\n\nNew worker sessions may make bounded changes in the configured workspace.",
      spokenSummary: "Switched Codex to execute mode."
    });
  }

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
    recordActivity({
      kind: "inspection",
      title: inspection.issueFound ? "Inspection found an issue" : "Inspection clear",
      detail: `${session.title}: ${inspection.summary}`,
      sessionId: session.id,
      severity: inspection.userNeeded ? "critical" : inspection.issueFound ? "warning" : "success"
    });
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
    /\b(continue|resume|retry|fix|resolve|follow up|start next)\b/.test(clean) &&
    /\b(actionable|blocked|blockers|failed|failures|issues|problems)\b/.test(clean)
  ) {
    const actionableSessions = agentActionableBlockedSessions().slice(0, 3);
    if (!actionableSessions.length) {
      return commandResponse({
        transcript: original,
        settings,
        answer:
          "I do not see any visible blocked or failed workers that are safe to continue automatically. If a worker needs credentials, approval, or a choice from you, I will keep it as user-needed instead.",
        spokenSummary: "No agent-actionable blocked workers are ready to continue."
      });
    }

    const nextSessions = actionableSessions.map((session) =>
      createBackgroundSession({
        title: `Resolve ${session.title}`.slice(0, 120),
        mode: modeFromSettings(settings),
        prompt: followUpPrompt(session, history, original)
      })
    );
    const newest = nextSessions[0];
    focusBackgroundSession(newest.id);
    recordActivity({
      kind: "worker",
      title: "Actionable blockers continued",
      detail: `Started ${nextSessions.length} follow-up worker${nextSessions.length === 1 ? "" : "s"} for agent-actionable blockers.`,
      sessionId: newest.id,
      severity: "warning"
    });
    const answer = [
      `Started ${nextSessions.length} follow-up worker${nextSessions.length === 1 ? "" : "s"} for agent-actionable blockers:`,
      ...nextSessions.map((session) => `- ${session.title} (${session.mode} mode)`),
      "",
      "I skipped anything marked user-needed, because those require your credentials, approval, or a decision."
    ].join("\n");
    return commandResponse({
      transcript: original,
      settings,
      answer,
      spokenSummary: `Started ${nextSessions.length} follow-up worker${nextSessions.length === 1 ? "" : "s"} for actionable blockers. User-needed blockers were left alone.`
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
