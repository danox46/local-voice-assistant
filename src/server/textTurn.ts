import crypto from "node:crypto";
import type {
  AssistantSettings,
  ConversationMessage,
  TextTurnResponse
} from "../shared/types";
import { sanitizeAssistantResponseForAudio } from "./responseSanitizer";
import type { AssistantResponder } from "./types";

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

export async function handleTextTurn(
  transcript: string,
  history: ConversationMessage[],
  settings: AssistantSettings,
  assistant: AssistantResponder
): Promise<TextTurnResponse> {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) {
    throw new Error("I did not catch any words. Try again.");
  }

  const userMessage = createMessage("user", cleanTranscript);
  const assistantResult = await assistant.respond({
    transcript: cleanTranscript,
    history,
    settings
  });

  return {
    userMessage,
    assistantMessage: createMessage("assistant", assistantResult.fullAnswer),
    spokenSummary: sanitizeAssistantResponseForAudio(assistantResult.spokenSummary),
    settings
  };
}
