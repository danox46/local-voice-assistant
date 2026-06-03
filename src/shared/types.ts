export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
}

export interface PlannerSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  lastError?: string;
}

export interface AssistantSettings {
  backend: "codex-cli" | "gemini-cli" | "openai";
  codexMode: "execute" | "plan";
  transcriptionMode: "gemini-cli-audio" | "browser" | "openai-cloud";
  speechLanguage: string;
  assistantStyle: string;
  assistantModel: string;
  transcribeModel: string;
  ttsModel: string;
  voice: string;
  summaryWords: number;
}

export interface VoiceTurnResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  spokenSummary: string;
  audioMimeType: string;
  audioBase64: string;
  settings: AssistantSettings;
  plannerSession?: PlannerSession;
}

export interface TextTurnResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  spokenSummary: string;
  settings: AssistantSettings;
  plannerSession?: PlannerSession;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export type BackgroundSessionStatus = "queued" | "running" | "done" | "blocked" | "failed" | "cancelled";
export type BackgroundSessionMode = "execute" | "plan";

export interface BackgroundSessionReport {
  summary: string;
  changed: string;
  verified: string;
  blockers: string;
  next: string;
}

export interface BackgroundSession {
  id: string;
  title: string;
  status: BackgroundSessionStatus;
  mode: BackgroundSessionMode;
  prompt: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  report: BackgroundSessionReport;
  rawOutput?: string;
  error?: string;
}
