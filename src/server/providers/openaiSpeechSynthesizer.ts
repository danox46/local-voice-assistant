import type OpenAI from "openai";
import type { AssistantSettings } from "../../shared/types";
import type { SpeechSynthesizer } from "../types";

export class OpenAISpeechSynthesizer implements SpeechSynthesizer {
  constructor(private readonly client: OpenAI) {}

  async synthesize(text: string, settings: AssistantSettings) {
    const response = await this.client.audio.speech.create({
      model: settings.ttsModel,
      voice: settings.voice,
      input: text,
      response_format: "mp3"
    });

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      mimeType: "audio/mpeg"
    };
  }
}
