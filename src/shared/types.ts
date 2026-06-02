export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
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
}

export interface TextTurnResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  spokenSummary: string;
  settings: AssistantSettings;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
