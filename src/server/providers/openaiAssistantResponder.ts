import type OpenAI from "openai";
import type { ConversationMessage } from "../../shared/types";
import type { AssistantResponder } from "../types";

function formatHistory(history: ConversationMessage[]) {
  return history
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function parseJsonResponse(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw);
}

export class OpenAIAssistantResponder implements AssistantResponder {
  constructor(private readonly client: OpenAI) {}

  async respond({ transcript, history, settings }: Parameters<AssistantResponder["respond"]>[0]) {
    const response = await this.client.responses.create({
      model: settings.assistantModel,
      input: [
        {
          role: "system",
          content:
            "You are the local voice assistant for the user. Return only valid JSON with keys fullAnswer and spokenSummary. The fullAnswer can be detailed and useful. The spokenSummary must be a natural out-loud summary, not a script label."
        },
        {
          role: "user",
          content: [
            `Assistant style: ${settings.assistantStyle}`,
            `Spoken summary target: ${settings.summaryWords} words or fewer.`,
            "Recent conversation:",
            formatHistory(history) || "(none yet)",
            "New user transcript:",
            transcript
          ].join("\n\n")
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "voice_turn",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["fullAnswer", "spokenSummary"],
            properties: {
              fullAnswer: { type: "string" },
              spokenSummary: { type: "string" }
            }
          },
          strict: true
        }
      }
    });

    const text = response.output_text;
    const parsed = parseJsonResponse(text) as {
      fullAnswer?: unknown;
      spokenSummary?: unknown;
    };

    if (typeof parsed.fullAnswer !== "string" || typeof parsed.spokenSummary !== "string") {
      throw new Error("Assistant returned an invalid response shape.");
    }

    return {
      fullAnswer: parsed.fullAnswer.trim(),
      spokenSummary: parsed.spokenSummary.trim()
    };
  }
}
