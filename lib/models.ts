import { transcribe, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { elevenlabs } from "@ai-sdk/elevenlabs";
import { google } from "@ai-sdk/google";

// Which models Sauti uses, set in .env as "provider:model", comma-separated = fallbacks in order.
//   AGENT_MODELS      — thinks and calls the ledger + PayPal tools
//   TRANSCRIBE_MODEL  — turns the trader's voice note into text
export const AGENT_MODELS = (process.env.AGENT_MODELS ?? "anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "elevenlabs:scribe_v2";

export function languageModel(spec: string): LanguageModel {
  const [provider, ...rest] = spec.split(":");
  const id = rest.join(":");
  switch (provider) {
    case "anthropic":
      return anthropic(id);
    case "google":
      return google(id);
    default:
      throw new Error(`Unknown model provider "${provider}" in "${spec}" (use anthropic: or google:)`);
  }
}

/** Swahili (or English, or a mix) voice note → text. Language is auto-detected unless TRANSCRIBE_LANGUAGE is set. */
export async function transcribeVoiceNote(audio: Uint8Array): Promise<string> {
  const [provider, id] = TRANSCRIBE_MODEL.split(":");
  if (provider !== "elevenlabs") throw new Error(`Unsupported TRANSCRIBE_MODEL "${TRANSCRIBE_MODEL}"`);
  const language = process.env.TRANSCRIBE_LANGUAGE; // e.g. "swa" to force Swahili
  const { text } = await transcribe({
    model: elevenlabs.transcription(id),
    audio,
    providerOptions: { elevenlabs: { tagAudioEvents: false, ...(language ? { languageCode: language } : {}) } },
    maxRetries: 3,
  });
  return text.trim();
}
