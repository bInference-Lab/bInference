import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "../views/inbox-message-view.schema.js";
import { readFlags, type OperationTable } from "./operation.schema.js";

/** The image formats the agent reads (protocol spec, section 7.7). */
export type ImageContentType = "image/png" | "image/jpeg" | "image/webp";

/** The most bytes of an image one `inbox/readImage` answer carries: 512 KiB. */
export const imagePartBytes: number = 512 * 1024;

/** The largest image the agent reads: 5 MiB (protocol spec, section 7.7). */
export const maxImageBytes: number = 5 * 1024 * 1024;

/** The most images one owner's message names (protocol spec, section 7.7). */
export const maxImagesPerMessage: number = 4;

/** The args of `inbox/readImage`: one image of an agent's own message, from `offset`. */
interface ReadImageArgs {
  readonly agent: ProtocolId<"agent">;
  readonly message: ProtocolId<"inboxMessage">;
  /** The upload id or `tg:<file_id>` the message names. */
  readonly image: string;
  /** Where this part starts, in bytes; 0 when absent. */
  readonly offset?: number;
}

/** One part of an image: at most {@link imagePartBytes} of it, in base64. */
export interface ImagePart {
  readonly contentType: ImageContentType;
  /** The whole image's size in bytes. */
  readonly bytes: number;
  readonly offset: number;
  /** The part's bytes in base64. */
  readonly data: string;
  /** Where the next part starts; absent on the last part. */
  readonly next?: number;
}

/**
 * The args of `image/view`: an image the agent looks at, at a public `http:` or `https:` address
 * or a file on the engine's machine, exactly one of the two, from `offset`.
 */
interface ViewImageArgs {
  readonly agent: ProtocolId<"agent">;
  readonly url?: string;
  /** Absolute, or under the owner's home folder; the home folder's own file names start it. */
  readonly path?: string;
  /** Where this part starts, in bytes; 0 when absent. */
  readonly offset?: number;
}

/** The most characters of a prompt the agent makes images with (decision 0392). */
export const maxImagePromptChars: number = 4_000;

/**
 * The args of `image/store`: one part of an image the agent made, at `place` in its job, from
 * `offset`, of an image `total` bytes long (decision 0392).
 */
interface StoreImageArgs {
  readonly agent: ProtocolId<"agent">;
  /** The runtime's id of the job, the same for every image it made. */
  readonly job: string;
  /** The image's place in its job, 0 to 3. */
  readonly place: number;
  readonly offset: number;
  readonly total: number;
  /** The part's bytes in base64, at most 512 KiB of them. */
  readonly data: string;
}

/** The answer of `image/store`: once the last part arrived, the saved image's id and path. */
interface StoredImagePart {
  readonly image?: string;
  readonly path?: string;
}

/**
 * The args of `image/made`: the end of an image job, its images by the ids `image/store` answered
 * or why it failed, and the turn and surface it was asked for in (decision 0392).
 */
interface MadeImagesArgs {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly turn: ProtocolId<"chatTurn">;
  /** The surface the owner asked on, which the wake-up names. */
  readonly surface: ChatSurface;
  readonly prompt: string;
  readonly images: readonly string[];
  /** Why the job made no image, in a line the agent reads. */
  readonly failed?: string;
}

/** The args of `image/read`: one part of an image the agent made, by its id, from `offset`. */
interface ReadMadeImageArgs {
  readonly agent: ProtocolId<"agent">;
  readonly image: string;
  readonly offset?: number;
}

/** The operations of the agent's images (protocol spec, section 7.7). */
export interface ImageOperationShapes {
  readonly "inbox/readImage": { readonly args: ReadImageArgs; readonly result: ImagePart };
  readonly "image/view": { readonly args: ViewImageArgs; readonly result: ImagePart };
  readonly "image/store": { readonly args: StoreImageArgs; readonly result: StoredImagePart };
  readonly "image/made": { readonly args: MadeImagesArgs; readonly result: Empty };
  readonly "image/read": { readonly args: ReadMadeImageArgs; readonly result: ImagePart };
}

/** Parses an image format the agent reads. */
export const imageContentTypeSchema: z.ZodType<ImageContentType> = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const byteCount = z.int().nonnegative().max(maxImageBytes);
// A part's base64 text: 4 characters for each 3 bytes, padded.
const maxPartText = Math.ceil(imagePartBytes / 3) * 4;

/** Parses an image's offset or size in bytes, at most 5 MiB. */
export const imageByteCountSchema: z.ZodType<number> = byteCount;

/** Parses one part of an image. */
export const imagePartSchema: z.ZodType<ImagePart> = z.object({
  contentType: imageContentTypeSchema,
  bytes: byteCount,
  offset: byteCount,
  data: z.base64().max(maxPartText),
  next: byteCount.exactOptional(),
});

const madeImageId = z.string().regex(/^[a-z0-9]{8,64}$/u);

/** Parses the answer of `image/store`. */
const storedImagePartSchema: z.ZodType<StoredImagePart> = z.object({
  image: madeImageId.exactOptional(),
  path: z.string().min(1).max(4_096).exactOptional(),
});

/** The image operation, by name. */
export const imageOperations: OperationTable<ImageOperationShapes> = {
  "inbox/readImage": {
    ...readFlags,
    name: "inbox/readImage",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      message: protocolIdSchema("inboxMessage"),
      image: plainIdSchema,
      offset: byteCount.exactOptional(),
    }),
    result: imagePartSchema,
  },
  "image/view": {
    ...readFlags,
    name: "image/view",
    scope: "agent",
    args: z
      .strictObject({
        agent: protocolIdSchema("agent"),
        url: z
          .string()
          .regex(/^https?:\/\//iu)
          .max(2_048)
          .exactOptional(),
        path: z.string().min(1).max(4_096).exactOptional(),
        offset: byteCount.exactOptional(),
      })
      .refine((args) => (args.url === undefined) !== (args.path === undefined), {
        message: "Name exactly one of url and path.",
      }),
    result: imagePartSchema,
  },
  "image/store": {
    ...readFlags,
    name: "image/store",
    scope: "agent",
    args: z
      .strictObject({
        agent: protocolIdSchema("agent"),
        job: madeImageId,
        place: z
          .int()
          .min(0)
          .max(maxImagesPerMessage - 1),
        offset: byteCount,
        total: byteCount.min(1),
        data: z.base64().min(1).max(maxPartText),
      })
      .refine((args) => args.offset < args.total, { message: "The part starts past the image." }),
    result: storedImagePartSchema,
  },
  "image/made": {
    ...readFlags,
    name: "image/made",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
      surface: chatSurfaceSchema,
      prompt: z.string().trim().min(1).max(maxImagePromptChars),
      images: z.array(madeImageId).max(maxImagesPerMessage).readonly(),
      failed: z.string().trim().min(1).max(500).exactOptional(),
    }),
    result: emptyResultSchema,
  },
  "image/read": {
    ...readFlags,
    name: "image/read",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      image: madeImageId,
      offset: byteCount.exactOptional(),
    }),
    result: imagePartSchema,
  },
};
