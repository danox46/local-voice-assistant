import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ConversationMessage, PlannerPrompt, PlannerSession } from "../shared/types";

const MAX_STORED_MESSAGES = 160;
const MAX_CONTEXT_MESSAGES = 36;
const SESSION_ID = "main";
const SESSION_TITLE = "Main planning session";
const sessionPath = path.join(process.cwd(), "work", "planner-session.json");

function now() {
  return new Date().toISOString();
}

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: now()
  };
}

function emptySession(): PlannerSession {
  const createdAt = now();
  return {
    id: SESSION_ID,
    title: SESSION_TITLE,
    createdAt,
    updatedAt: createdAt,
    messages: []
  };
}

function ensureWorkDir() {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
}

function normalizeSession(session: PlannerSession): PlannerSession {
  return {
    ...session,
    id: session.id || SESSION_ID,
    title: session.title || SESSION_TITLE,
    createdAt: session.createdAt || now(),
    updatedAt: session.updatedAt || now(),
    messages: Array.isArray(session.messages) ? session.messages.slice(-MAX_STORED_MESSAGES) : [],
    activePlannerPrompt: normalizePlannerPrompt(session.activePlannerPrompt)
  };
}

function normalizePlannerPrompt(prompt: unknown): PlannerPrompt | undefined {
  if (!prompt || typeof prompt !== "object") return undefined;
  const candidate = prompt as Partial<PlannerPrompt>;
  if (
    typeof candidate.topic !== "string" ||
    candidate.status !== "needs-input" ||
    !Array.isArray(candidate.questions)
  ) {
    return undefined;
  }
  const questions = candidate.questions.filter((question) => {
    if (!question || typeof question !== "object") return false;
    const item = question as Partial<PlannerPrompt["questions"][number]>;
    return Boolean(item.id && item.label && item.question && item.why);
  }).map((question) => {
    const item = question as PlannerPrompt["questions"][number];
    return {
      id: item.id,
      label: item.label,
      question: item.question,
      why: item.why,
      answeredAt: typeof item.answeredAt === "string" ? item.answeredAt : undefined
    };
  }) as PlannerPrompt["questions"];
  if (!questions.length) return undefined;
  return {
    topic: candidate.topic,
    status: "needs-input",
    questions
  };
}

let cachedSession: PlannerSession | null = null;

function readSession() {
  if (cachedSession) return cachedSession;
  try {
    if (!fs.existsSync(sessionPath)) {
      cachedSession = emptySession();
      return cachedSession;
    }
    const parsed = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as PlannerSession;
    cachedSession = normalizeSession(parsed);
    return cachedSession;
  } catch {
    cachedSession = emptySession();
    return cachedSession;
  }
}

function writeSession(session: PlannerSession) {
  ensureWorkDir();
  cachedSession = normalizeSession({ ...session, updatedAt: now() });
  fs.writeFileSync(sessionPath, JSON.stringify(cachedSession, null, 2));
  return cachedSession;
}

export function getPlannerSession() {
  return readSession();
}

export function getPlannerContextMessages() {
  return readSession().messages.slice(-MAX_CONTEXT_MESSAGES);
}

export function formatPlannerSessionMarkdown(session = readSession()) {
  const messages = session.messages.length
    ? session.messages.map((message, index) =>
        [
          `## ${index + 1}. ${message.role === "user" ? "User" : "Assistant"}`,
          "",
          `Created: ${message.createdAt}`,
          "",
          message.content
        ].join("\n")
      )
    : ["_No saved messages yet._"];
  const activePrompt = session.activePlannerPrompt
    ? [
        "## Active Planning Questions",
        "",
        `Topic: ${session.activePlannerPrompt.topic}`,
        "",
        ...session.activePlannerPrompt.questions.map((question, index) =>
          [
            `${index + 1}. ${question.question}${question.answeredAt ? " [answered]" : ""}`,
            `   - Label: ${question.label}`,
            `   - Why: ${question.why}`
          ].join("\n")
        ),
        ""
      ]
    : [];

  return [
    `# ${session.title}`,
    "",
    `Session: ${session.id}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    "",
    ...activePrompt,
    ...messages
  ].join("\n");
}

export function appendPlannerTurnToSession(
  session: PlannerSession,
  userMessage: ConversationMessage,
  assistantMessage: ConversationMessage,
  plannerPrompt?: PlannerPrompt
) {
  return {
    ...session,
    lastError: undefined,
    activePlannerPrompt: plannerPrompt,
    messages: [...session.messages, userMessage, assistantMessage].slice(-MAX_STORED_MESSAGES)
  };
}

export function appendPlannerTurn(
  userMessage: ConversationMessage,
  assistantMessage: ConversationMessage,
  plannerPrompt?: PlannerPrompt
) {
  return writeSession(appendPlannerTurnToSession(readSession(), userMessage, assistantMessage, plannerPrompt));
}

export function removeLastPlannerTurnFromSession(session: PlannerSession): PlannerSession {
  const messages = [...session.messages];
  if (messages.at(-1)?.role === "assistant") {
    messages.pop();
  }
  if (messages.at(-1)?.role === "user") {
    messages.pop();
  }
  return {
    ...session,
    activePlannerPrompt: undefined,
    lastError: undefined,
    messages
  };
}

export function retryLastPlannerTurn() {
  return writeSession(removeLastPlannerTurnFromSession(readSession()));
}

export function updateActivePlannerQuestionInSession(
  session: PlannerSession,
  questionId: string,
  answered: boolean
): PlannerSession {
  const prompt = session.activePlannerPrompt;
  if (!prompt) return session;
  const nextPrompt: PlannerPrompt = {
    ...prompt,
    questions: prompt.questions.map((question) =>
      question.id === questionId
        ? {
            ...question,
            answeredAt: answered ? now() : undefined
          }
        : question
    )
  };
  return {
    ...session,
    activePlannerPrompt: nextPrompt
  };
}

export function updateActivePlannerQuestion(questionId: string, answered: boolean) {
  return writeSession(updateActivePlannerQuestionInSession(readSession(), questionId, answered));
}

export function recordPlannerFailure(transcript: string, errorMessage: string) {
  const session = readSession();
  const userMessage = createMessage("user", transcript.trim());
  const assistantMessage = createMessage(
    "assistant",
    `That turn failed before I could finish: ${errorMessage}. The conversation up to this point is still saved, so you can refresh and ask me to resume.`
  );
  return writeSession({
    ...session,
    activePlannerPrompt: undefined,
    lastError: errorMessage,
    messages: [...session.messages, userMessage, assistantMessage].slice(-MAX_STORED_MESSAGES)
  });
}

export function resetPlannerSession() {
  return writeSession(emptySession());
}
