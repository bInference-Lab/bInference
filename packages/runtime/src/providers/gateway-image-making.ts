import { type GatewayImages, gatewayImagesOf } from "./gateway-image-answer.schema.js";
import { type GatewayImageModel, gatewayImageModelOf } from "./gateway-image-models.schema.js";
import type { ImageMaker, ImageMakingOutcome, ImageMakingRequest } from "./image-making.js";

/** The aspect ratio of each size the agent may ask for. */
const aspectRatios: Readonly<Record<NonNullable<ImageMakingRequest["size"]>, string>> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  auto: "auto",
};

/** An image to start from, inline, as the gateway's `input_references` take it. */
interface InputReference {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

/** The body of `POST /images` (decision 0398): only the fields the model lists. */
export interface GatewayImageBody {
  readonly model: string;
  readonly prompt: string;
  readonly n: number;
  readonly resolution?: string;
  readonly aspect_ratio?: string;
  readonly quality?: string;
  readonly output_format?: string;
  readonly background?: string;
  readonly input_references?: readonly InputReference[];
}

/** The answer a raw call gives: the JSON the gateway sent. */
type Answer = Parameters<typeof gatewayImagesOf>[0];

/** The gateway's image endpoint, as the provider's own client reaches it. */
export interface GatewayImageClient {
  /** `GET /images/models`: every image model and the fields it takes. */
  models(signal: AbortSignal): Promise<Answer>;
  /** `POST /images`: makes the images. */
  create(body: GatewayImageBody, signal: AbortSignal): Promise<Answer>;
}

// The gateway takes at most 4 MB per request; references go inline as base64, a third larger.
const maxBodyBytes = 4_000_000;

// A value the model lists, or none, so the call never sends a field the model refuses.
function listed(values: readonly string[], value: string | undefined): string | undefined {
  return value !== undefined && values.includes(value) ? value : undefined;
}

function bodyOf(
  model: string,
  facts: GatewayImageModel,
  request: ImageMakingRequest,
): GatewayImageBody {
  // Every size the agent asks for is about a megapixel; left out, the gateway reserves its largest.
  const fields = {
    resolution: listed(facts.resolutions, "1K"),
    aspect_ratio: listed(
      facts.aspectRatios,
      request.size === undefined ? undefined : aspectRatios[request.size],
    ),
    quality: listed(facts.qualities, request.quality),
    output_format: listed(facts.outputFormats, request.outputFormat),
    background: listed(facts.backgrounds, request.background),
  };
  const set = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const references = facts.readsImages
    ? request.references.map(({ contentType, bytes }): InputReference => ({
        type: "image_url",
        image_url: { url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` },
      }))
    : [];
  return {
    model,
    prompt: request.prompt,
    n: Math.min(request.count, Math.max(facts.maxCount, 1)),
    ...set,
    ...(references.length === 0 ? {} : { input_references: references }),
  };
}

// The images, at most as many as were asked, or the gateway's own words for why none came.
function outcomeOf(answer: GatewayImages, count: number): ImageMakingOutcome {
  if (answer.images.length > 0) {
    const usage = answer.usage === undefined ? {} : { usage: { ...answer.usage, cachedTokens: 0 } };
    return { ok: true, images: answer.images.slice(0, count), ...usage };
  }
  const failure =
    answer.error === undefined
      ? `the gateway answered with no image (${answer.shape})`
      : `the provider said: ${answer.error}`;
  return { ok: false, failure };
}

/**
 * Makes images through the bInference gateway's image endpoint (decision 0398): the model's entry
 * of `GET /images/models`, read once, says which fields it takes, and `POST /images` gets only
 * those, the images coming back as base64. A model the list does not hold is named, with where
 * the owner finds one. The gateway's error, sent with a success, is said in its own words.
 */
export function gatewayImageMaker(
  names: { readonly name: string; readonly model: string },
  client: GatewayImageClient,
  failureOf: (error: ErrorOptions["cause"], signal: AbortSignal) => string,
): ImageMaker {
  const facts: { read: Promise<GatewayImageModel | undefined> | undefined } = { read: undefined };
  const factsOf = async (signal: AbortSignal): Promise<GatewayImageModel | undefined> => {
    // A failed read is not kept: the catch below clears it, so the next call reads again.
    facts.read ??= client.models(signal).then((list) => gatewayImageModelOf(list, names.model));
    return facts.read;
  };
  return {
    model: names.name,
    make: async (request, signal): Promise<ImageMakingOutcome> => {
      try {
        const model = await factsOf(signal);
        if (model === undefined) {
          return {
            ok: false,
            failure: `${names.name} is not one of the gateway's image models: the owner sets models.imageMaking to one of GET /images/models, such as binference/openai/gpt-image-2`,
          };
        }
        const body = bodyOf(names.model, model, request);
        if (Buffer.byteLength(JSON.stringify(body)) > maxBodyBytes) {
          return {
            ok: false,
            failure:
              "the images to start from are too large to send: the gateway takes at most 4 MB per request, so use fewer or smaller images",
          };
        }
        return outcomeOf(gatewayImagesOf(await client.create(body, signal)), request.count);
      } catch (error) {
        facts.read = undefined;
        return { ok: false, failure: failureOf(error, signal) };
      }
    },
  };
}
