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
  activePlannerPrompt?: PlannerPrompt;
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

export interface PlannerQuestion {
  id: string;
  label: string;
  question: string;
  why: string;
}

export interface PlannerPrompt {
  topic: string;
  status: "needs-input";
  questions: PlannerQuestion[];
}

export interface VoiceTurnResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  spokenSummary: string;
  audioMimeType: string;
  audioBase64: string;
  settings: AssistantSettings;
  plannerSession?: PlannerSession;
  plannerPrompt?: PlannerPrompt;
}

export interface TextTurnResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  spokenSummary: string;
  settings: AssistantSettings;
  plannerSession?: PlannerSession;
  plannerPrompt?: PlannerPrompt;
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

export type SessionSupervisionLevel = "normal" | "stale" | "needs-user" | "auto-actionable";

export interface SessionSupervision {
  level: SessionSupervisionLevel;
  reason: string;
  userNeeded: boolean;
  shouldNotify: boolean;
  checkedAt: string;
}

export interface SessionInspection {
  sessionId: string;
  issueFound: boolean;
  userNeeded: boolean;
  severity: "none" | "info" | "warning" | "critical";
  summary: string;
  evidence: string;
  inspectedAt: string;
}

export type ActivityEventKind =
  | "mode"
  | "worker"
  | "inspection"
  | "focus"
  | "archive"
  | "notification"
  | "system";

export interface ActivityEvent {
  id: string;
  kind: ActivityEventKind;
  title: string;
  detail: string;
  createdAt: string;
  sessionId?: string;
  severity?: "info" | "success" | "warning" | "critical";
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
  supervision: SessionSupervision;
  focused: boolean;
  archivedAt?: string;
  rawOutput?: string;
  error?: string;
}
