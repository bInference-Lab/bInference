import type { Clock } from "@binference/core";
import type { ImageContentType } from "@binference/protocol";
import { toFile } from "openai";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import type { ModelUsage } from "../loop/model-event.js";
import { createChatClient } from "./chat-completions-transport.js";
import { baseUrlOf } from "./model-transport-for.js";
import type { StreamingHttp } from "./ports.js";

/** An image the model is shown: a reference that turns the request into an edit. */
interface ReferenceImage {
  readonly contentType: ImageContentType;
  readonly bytes: Readonly<Uint8Array>;
}

/** What the agent asks the image model for (decision 0392). */
export interface ImageMakingRequest {
  readonly prompt: string;
  /** How many images, 1 to 4. */
  readonly count: number;
  readonly size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  readonly quality?: "low" | "medium" | "high" | "auto";
  readonly outputFormat: "png" | "jpeg" | "webp";
  readonly background?: "transparent" | "opaque" | "auto";
  /** Images the model starts from; none makes new images. */
  readonly references: readonly ReferenceImage[];
}

/** The images the model made and its usage, or why it made none, in a line the agent reads. */
export type ImageMakingOutcome =
  | {
      readonly ok: true;
      readonly images: readonly Uint8Array[];
      readonly usage?: ModelUsage;
    }
  | { readonly ok: false; readonly failure: string };

/** The model that makes the agent's images, by its `<provider>/<model>` name. */
export interface ImageMaker {
  readonly model: string;
  make(request: ImageMakingRequest, signal: AbortSignal): Promise<ImageMakingOutcome>;
}

/** What an image model's client reaches the network and the time through. */
export interface ImageMakingParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

/** How long an image model may take for one request: image models can take minutes. */
const imageMakingTimeoutMs = 300_000;

const extensions: Readonly<Record<ImageContentType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The answer's images and usage, as the Images API writes them. */
interface ImagesAnswer {
  readonly data?: readonly { readonly b64_json?: string }[];
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
}

function outcomeOf(answer: ImagesAnswer): ImageMakingOutcome {
  const images = (answer.data ?? []).flatMap((image) =>
    image.b64_json === undefined ? [] : [new Uint8Array(Buffer.from(image.b64_json, "base64"))],
  );
  if (images.length === 0) {
    return { ok: false, failure: "the model answered with no image" };
  }
  const { usage } = answer;
  return usage === undefined
    ? { ok: true, images }
    : {
        ok: true,
        images,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: 0,
        },
      };
}

// Why a request failed, in a line: the provider's own words cut short, or that it took too long.
function failureOf(error: ErrorOptions["cause"], signal: AbortSignal): string {
  if (signal.aborted) {
    return "it took longer than 5 minutes";
  }
  const words = error instanceof Error ? error.message.replaceAll(/\s+/gu, " ").trim() : "";
  return words === ""
    ? "the model's provider did not answer"
    : `the provider said: ${words.slice(0, 300)}`;
}

function makerOn(options: {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly name: string;
  readonly parts: ImageMakingParts;
}): ImageMaker {
  const client = createChatClient({
    baseUrl: options.baseUrl,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    model: options.model,
    timeoutMs: imageMakingTimeoutMs,
    http: options.parts.http,
    clock: options.parts.clock,
  });
  return {
    model: options.name,
    make: async (request, signal) => {
      const { prompt, count, size, quality, outputFormat, background, references } = request;
      const shape = {
        model: options.model,
        prompt,
        n: count,
        output_format: outputFormat,
        ...(size === undefined ? {} : { size }),
        ...(quality === undefined ? {} : { quality }),
        ...(background === undefined ? {} : { background }),
      };
      try {
        if (references.length === 0) {
          return outcomeOf(await client.images.generate(shape, { signal }));
        }
        const image = await Promise.all(
          references.map(async (reference, place) =>
            toFile(
              Buffer.from(reference.bytes),
              `reference-${String(place)}.${extensions[reference.contentType]}`,
              {
                type: reference.contentType,
              },
            ),
          ),
        );
        return outcomeOf(await client.images.edit({ ...shape, image }, { signal }));
      } catch (error) {
        return { ok: false, failure: failureOf(error, signal) };
      }
    },
  };
}

/**
 * The model that makes the agent's images under the settings in force (decision 0392):
 * `models.imageMaking` on a provider that speaks OpenAI's Images API (`openai` or `binference`),
 * through the same official client and fetch as Chat Completions. Answers why there is none, in a
 * line the agent reads, when the setting is missing or names another kind of provider.
 */
export function imageMakerFor(
  models: Pick<RuntimeModels, "providers" | "imageMaking">,
  parts: ImageMakingParts,
): ImageMaker | string {
  const name = models.imageMaking;
  const slash = name?.indexOf("/") ?? -1;
  if (name === undefined || slash <= 0 || slash === name.length - 1) {
    return "No model makes images: the owner sets one in models.imageMaking as <provider>/<model>. Tell the owner.";
  }
  const provider = models.providers[name.slice(0, slash)];
  if (provider === undefined || provider.kind === "anthropic") {
    return "The provider of models.imageMaking is not in models.providers, or does not speak OpenAI's Images API. Tell the owner.";
  }
  return makerOn({
    baseUrl: baseUrlOf(provider),
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
    model: name.slice(slash + 1),
    name,
    parts,
  });
}
