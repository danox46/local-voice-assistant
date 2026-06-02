import { toFile } from "openai/uploads";
import type OpenAI from "openai";
import type { AudioInput, Transcriber } from "../types";
import type { AssistantSettings } from "../../shared/types";

export class OpenAITranscriber implements Transcriber {
  constructor(private readonly client: OpenAI) {}

  async transcribe(audio: AudioInput, settings: AssistantSettings) {
    const file = await toFile(audio.buffer, audio.filename, {
      type: audio.mimeType
    });

    const result = await this.client.audio.transcriptions.create({
      file,
      model: settings.transcribeModel
    });

    return result.text.trim();
  }
}
