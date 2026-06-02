import type { AssistantSettings, ConversationMessage } from "../shared/types";

export interface AudioInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  path?: string;
}

export interface Transcriber {
  transcribe(audio: AudioInput, settings: AssistantSettings): Promise<string>;
}

export interface AssistantResponder {
  respond(input: {
    transcript: string;
    history: ConversationMessage[];
    settings: AssistantSettings;
  }): Promise<{ fullAnswer: string; spokenSummary: string }>;
}

export interface SpeechSynthesizer {
  synthesize(text: string, settings: AssistantSettings): Promise<{
    audio: Buffer;
    mimeType: string;
  }>;
}

export interface ListenerMode {
  id: string;
  label: string;
  startsAutomatically: boolean;
}

export interface IntegrationBoundary {
  id: string;
  label: string;
  enabled: boolean;
}
