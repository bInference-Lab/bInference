import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
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

/** The operation the agent runtime reads the owner's images with (protocol spec, section 7.7). */
export interface ImageOperationShapes {
  readonly "inbox/readImage": { readonly args: ReadImageArgs; readonly result: ImagePart };
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
    result: z.object({
      contentType: imageContentTypeSchema,
      bytes: byteCount,
      offset: byteCount,
      data: z.base64().max(maxPartText),
      next: byteCount.exactOptional(),
    }),
  },
};
