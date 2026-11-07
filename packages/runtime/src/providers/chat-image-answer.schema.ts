import { z } from "zod";

/** The images a chat answer carried, as bytes, and the tokens it used. */
export interface ChatImages {
  readonly images: readonly Uint8Array[];
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

const imageUrl = z.object({ url: z.string() });
const part = z.object({
  type: z.string().optional(),
  image_url: imageUrl.optional(),
  b64_json: z.string().optional(),
});
const answerSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            images: z.array(z.object({ image_url: imageUrl })).optional(),
            content: z.union([z.string(), z.array(part), z.null()]).optional(),
          })
          .nullish(),
      }),
    )
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

const dataUrl = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/u;
const dataUrlsInText = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gu;

// The bytes of an image a data URL holds; a link to elsewhere is never fetched.
function bytesOf(url: string): readonly Uint8Array[] {
  const base64 = dataUrl.exec(url)?.[1];
  return base64 === undefined ? [] : [new Uint8Array(Buffer.from(base64, "base64"))];
}

type Message = NonNullable<NonNullable<z.infer<typeof answerSchema>["choices"]>[number]["message"]>;

function contentImages(content: Message["content"]): readonly Uint8Array[] {
  if (typeof content === "string") {
    return [...content.matchAll(dataUrlsInText)].flatMap(([url]) => bytesOf(url));
  }
  return (content ?? []).flatMap((item) => {
    if (item.image_url !== undefined) {
      return bytesOf(item.image_url.url);
    }
    return item.b64_json === undefined
      ? []
      : [new Uint8Array(Buffer.from(item.b64_json, "base64"))];
  });
}

/**
 * The images of a chat completions answer from a model that makes images (decision 0397): each
 * entry of a message's `images`, then data URLs in its content, in text or in parts. A link to an
 * image elsewhere is never fetched. `undefined` for an answer that is not a chat completion.
 */
export function chatImagesOf(answer: unknown): ChatImages | undefined {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) {
    return undefined;
  }
  const messages = (parsed.data.choices ?? []).flatMap(({ message }) =>
    message === undefined || message === null ? [] : [message],
  );
  const images = messages.flatMap((message) =>
    (message.images ?? [])
      .flatMap(({ image_url }) => bytesOf(image_url.url))
      .concat(contentImages(message.content)),
  );
  const { usage } = parsed.data;
  return usage === undefined
    ? { images }
    : {
        images,
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        },
      };
}
