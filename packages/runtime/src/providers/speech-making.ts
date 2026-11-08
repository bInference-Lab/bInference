import type { Clock } from "@binference/core";
import { maxVoiceBytes } from "@binference/protocol";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import { createChatClient } from "./chat-completions-transport.js";
import { baseUrlOf } from "./model-transport-for.js";
import type { StreamingHttp } from "./ports.js";

/** The audio a model spoke, or why it spoke none, in a line the agent reads. */
export type SpeechOutcome =
  | { readonly ok: true; readonly audio: Uint8Array }
  | { readonly ok: false; readonly failure: string };

/** A model that speaks the agent's words, by its `<provider>/<model>` name (decision 0405). */
export interface SpeechMaker {
  readonly model: string;
  speak(
    request: { readonly text: string; readonly voice?: string },
    signal: AbortSignal,
  ): Promise<SpeechOutcome>;
}

/**
 * What speaks the agent's words under the settings in force (decision 0405): a model, the voice of
 * the engine's machine, or nothing, with why in a line the agent reads.
 */
export type SpeechSource =
  | { readonly kind: "model"; readonly maker: SpeechMaker }
  | { readonly kind: "local" }
  | { readonly kind: "none"; readonly failure: string };

/** What a speech model's client reaches the network and the time through. */
export interface SpeechMakingParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

// How long a model may take to speak 4,000 characters, and the voice when none is named.
const speechTimeoutMs = 120_000;
const defaultVoice = "alloy";

// Why a request failed, in a line: the provider's own words cut short, or that it took too long.
function failureOf(error: ErrorOptions["cause"], signal: AbortSignal): string {
  if (signal.aborted) {
    return "it took longer than 2 minutes";
  }
  const words = error instanceof Error ? error.message.replaceAll(/\s+/gu, " ").trim() : "";
  return words === ""
    ? "the model's provider did not answer"
    : `the provider said: ${words.slice(0, 300)}`;
}

function makerOn(
  provider: RuntimeModels["providers"][string],
  names: { readonly name: string; readonly model: string },
  parts: SpeechMakingParts,
): SpeechMaker {
  const client = createChatClient({
    baseUrl: baseUrlOf(provider),
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
    model: names.model,
    timeoutMs: speechTimeoutMs,
    http: parts.http,
    clock: parts.clock,
  });
  return {
    model: names.name,
    speak: async (request, signal) => {
      try {
        const answer = await client.audio.speech.create(
          {
            model: names.model,
            input: request.text,
            voice: request.voice ?? defaultVoice,
            response_format: "opus",
          },
          { signal },
        );
        const audio = new Uint8Array(await answer.arrayBuffer());
        if (audio.byteLength === 0 || audio.byteLength > maxVoiceBytes) {
          return { ok: false, failure: "the model answered with no audio binference keeps" };
        }
        return { ok: true, audio };
      } catch (error) {
        return { ok: false, failure: failureOf(error, signal) };
      }
    },
  };
}

/**
 * What speaks the agent's words under the settings in force (decision 0405): `models.speech` on
 * an `openai` provider through its `POST /audio/speech`, asking for Ogg Opus with the same
 * official client and fetch as the agent's chats, or `local` for the engine machine's own voice.
 * Says why there is none, in a line the agent reads, when the setting is missing or names another
 * kind of provider.
 */
export function speechSourceFor(
  models: Pick<RuntimeModels, "providers" | "speech">,
  parts: SpeechMakingParts,
): SpeechSource {
  const name = models.speech;
  if (name === "local") {
    return { kind: "local" };
  }
  const slash = name?.indexOf("/") ?? -1;
  if (name === undefined || slash <= 0 || slash === name.length - 1) {
    return {
      kind: "none",
      failure:
        "Nothing speaks: the owner sets models.speech to <provider>/<model> on an OpenAI-compatible provider, or to local on macOS. Tell the owner.",
    };
  }
  const provider = models.providers[name.slice(0, slash)];
  if (provider?.kind !== "openai") {
    return {
      kind: "none",
      failure:
        "The provider of models.speech is not an openai provider in models.providers, which alone speaks. Tell the owner.",
    };
  }
  return { kind: "model", maker: makerOn(provider, { name, model: name.slice(slash + 1) }, parts) };
}
