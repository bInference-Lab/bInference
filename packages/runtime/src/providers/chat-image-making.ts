import { chatImagesOf } from "./chat-image-answer.schema.js";
import type { ImageMaker, ImageMakingOutcome, ImageMakingRequest } from "./image-making.js";

/** The aspect ratio a Gemini image model takes for each size the agent may ask for. */
const aspectRatios: Readonly<Record<NonNullable<ImageMakingRequest["size"]>, string | undefined>> =
  {
    "1024x1024": "1:1",
    "1536x1024": "3:2",
    "1024x1536": "2:3",
    auto: undefined,
  };

/** The answer a chat client gives a raw post: the JSON the provider sent. */
type PostAnswer = Parameters<typeof chatImagesOf>[0];

/** One part of a message that asks for images: its words, or an image to start from. */
type ImagePromptPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

/** A chat completions body that asks a model for images (decision 0397). */
export interface ImageChatBody {
  readonly model: string;
  readonly messages: readonly {
    readonly role: "user";
    readonly content: string | readonly ImagePromptPart[];
  }[];
  readonly modalities: readonly string[];
  readonly n: number;
  readonly image_config?: { readonly aspect_ratio: string };
}

/** A client that posts a chat completions body as the provider's own client does. */
export interface ChatPoster {
  post(body: ImageChatBody, signal: AbortSignal): Promise<PostAnswer>;
}

// The message the model reads: the prompt, and the images to start from as data URLs.
function contentOf(request: ImageMakingRequest): string | readonly ImagePromptPart[] {
  if (request.references.length === 0) {
    return request.prompt;
  }
  const images = request.references.map(({ contentType, bytes }): ImagePromptPart => ({
    type: "image_url",
    image_url: { url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` },
  }));
  return [{ type: "text", text: request.prompt }, ...images];
}

/** The chat completions body that asks a model for images (decision 0397). */
function imageChatBody(model: string, request: ImageMakingRequest): ImageChatBody {
  const ratio = request.size === undefined ? undefined : aspectRatios[request.size];
  const isGemini = model.startsWith("google/gemini-");
  const config = isGemini && ratio !== undefined ? { image_config: { aspect_ratio: ratio } } : {};
  return {
    model,
    messages: [{ role: "user", content: contentOf(request) }],
    modalities: ["image", "text"],
    n: request.count,
    ...config,
  };
}

/**
 * Makes images through chat completions, the way the bInference gateway serves image models
 * (decision 0397): the prompt, and any images to start from, go as one message asking for image
 * and text output, and the images come back as data URLs. A model that answers with no image
 * likely makes none.
 */
export function chatImageMaker(
  names: { readonly name: string; readonly model: string },
  poster: ChatPoster,
  failureOf: (error: ErrorOptions["cause"], signal: AbortSignal) => string,
): ImageMaker {
  return {
    model: names.name,
    make: async (request, signal): Promise<ImageMakingOutcome> => {
      try {
        const answer = chatImagesOf(await poster.post(imageChatBody(names.model, request), signal));
        if (answer === undefined || answer.images.length === 0) {
          return {
            ok: false,
            failure: `the model answered with no image, so ${names.name} likely does not make images: the owner picks a model whose output includes images`,
          };
        }
        const usage =
          answer.usage === undefined ? {} : { usage: { ...answer.usage, cachedTokens: 0 } };
        return { ok: true, images: answer.images.slice(0, request.count), ...usage };
      } catch (error) {
        return { ok: false, failure: failureOf(error, signal) };
      }
    },
  };
}
