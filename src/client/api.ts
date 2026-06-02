import type {
  ApiErrorResponse,
  AssistantSettings,
  ConversationMessage,
  TextTurnResponse,
  VoiceTurnResponse
} from "../shared/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export interface HealthResponse {
  ok: boolean;
  hasOpenAiKey: boolean;
  hasGeminiCli: boolean;
  hasCodexCli: boolean;
  settings: AssistantSettings;
  activeListenerMode: string;
  listenerModes: Array<{ id: string; label: string; startsAutomatically: boolean }>;
  integrations: Array<{ id: string; label: string; enabled: boolean }>;
}

async function parseApiError(response: Response) {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return body.error.message;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return (await response.json()) as HealthResponse;
}

export async function sendVoiceTurn(input: {
  audio: Blob;
  history: ConversationMessage[];
  settings: AssistantSettings;
}): Promise<VoiceTurnResponse> {
  const form = new FormData();
  form.append("audio", input.audio, "recording.webm");
  form.append("history", JSON.stringify(input.history));
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch(`${API_BASE_URL}/api/voice-turn`, {
    method: "POST",
    body: form
  });

  if (!response.ok) throw new Error(await parseApiError(response));
  return (await response.json()) as VoiceTurnResponse;
}

export async function sendAudioTextTurn(input: {
  audio: Blob;
  history: ConversationMessage[];
  settings: AssistantSettings;
  signal?: AbortSignal;
}): Promise<TextTurnResponse> {
  const form = new FormData();
  form.append("audio", input.audio, "recording.webm");
  form.append("history", JSON.stringify(input.history));
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch(`${API_BASE_URL}/api/audio-text-turn`, {
    method: "POST",
    body: form,
    signal: input.signal
  });

  if (!response.ok) throw new Error(await parseApiError(response));
  return (await response.json()) as TextTurnResponse;
}

export async function sendTextTurn(input: {
  transcript: string;
  history: ConversationMessage[];
  settings: AssistantSettings;
  signal?: AbortSignal;
}): Promise<TextTurnResponse> {
  const response = await fetch(`${API_BASE_URL}/api/text-turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transcript: input.transcript,
      history: input.history,
      settings: input.settings
    }),
    signal: input.signal
  });

  if (!response.ok) throw new Error(await parseApiError(response));
  return (await response.json()) as TextTurnResponse;
}

export async function cancelTurn() {
  const response = await fetch(`${API_BASE_URL}/api/cancel-turn`, {
    method: "POST"
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return (await response.json()) as { cancelled: boolean };
}
