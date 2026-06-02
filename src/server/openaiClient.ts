import OpenAI from "openai";
import { config } from "./config";

export function createOpenAIClient() {
  return new OpenAI({
    apiKey: config.OPENAI_API_KEY
  });
}
