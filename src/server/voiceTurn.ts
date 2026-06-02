import crypto from "node:crypto";
import type {
  AssistantSettings,
  ConversationMessage,
  VoiceTurnResponse
} from "../shared/types";
import type { AssistantResponder, AudioInput, SpeechSynthesizer, Transcriber } from "./types";
import { sanitizeAssistantResponseForAudio } from "./responseSanitizer";

export interface VoiceTurnDeps {
  transcriber: Transcriber;
  assistant: AssistantResponder;
  speech: SpeechSynthesizer;
}

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

export async function handleVoiceTurn(
  audio: AudioInput,
  history: ConversationMessage[],
  settings: AssistantSettings,
  deps: VoiceTurnDeps
): Promise<VoiceTurnResponse> {
  if (!audio.buffer.byteLength) {
    throw new Error("The recording was empty. Try again with a little more audio.");
  }

  const transcript = await deps.transcriber.transcribe(audio, settings);

  if (!transcript) {
    throw new Error("I could not hear any words in that recording. Try again closer to the microphone.");
  }

  const userMessage = createMessage("user", transcript);
  const assistantResult = await deps.assistant.respond({
    transcript,
    history,
    settings
  });
  const assistantMessage = createMessage("assistant", assistantResult.fullAnswer);
  const spokenSummary = sanitizeAssistantResponseForAudio(assistantResult.spokenSummary);
  const speech = await deps.speech.synthesize(spokenSummary, settings);

  return {
    userMessage,
    assistantMessage,
    spokenSummary,
    audioMimeType: speech.mimeType,
    audioBase64: speech.audio.toString("base64"),
    settings
  };
}
