import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ConversationMessage, PlannerSession } from "../shared/types";

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
    messages: Array.isArray(session.messages) ? session.messages.slice(-MAX_STORED_MESSAGES) : []
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

export function appendPlannerTurn(
  userMessage: ConversationMessage,
  assistantMessage: ConversationMessage
) {
  const session = readSession();
  return writeSession({
    ...session,
    lastError: undefined,
    messages: [...session.messages, userMessage, assistantMessage].slice(-MAX_STORED_MESSAGES)
  });
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
    lastError: errorMessage,
    messages: [...session.messages, userMessage, assistantMessage].slice(-MAX_STORED_MESSAGES)
  });
}

export function resetPlannerSession() {
  return writeSession(emptySession());
}
