import { err, ok } from "@binference/core";
import type { ImageContentType } from "@binference/protocol";
import type { ImageReadRefusal } from "../relay/engine-chat-records.js";
import type { OwnerImageReader } from "../relay/ports.js";

/** An image a test's engine holds, by the name the owner's message gives it. */
export interface MemoryImage {
  readonly contentType: ImageContentType;
  readonly bytes: Uint8Array;
}

/**
 * An in-memory {@link OwnerImageReader} for tests: each image by its name, whatever message names
 * it; a name it holds a refusal for answers that refusal, any other `not_found`.
 */
export function createMemoryImageReader(
  images: ReadonlyMap<string, MemoryImage>,
  refusals: ReadonlyMap<string, ImageReadRefusal> = new Map(),
): OwnerImageReader {
  return {
    async read(place, signal) {
      signal.throwIfAborted();
      const image = images.get(place.image);
      if (image === undefined) {
        return Promise.resolve(err(refusals.get(place.image) ?? "not_found"));
      }
      const data = Buffer.from(image.bytes).toString("base64");
      const { contentType } = image;
      return Promise.resolve(ok({ contentType, data, bytes: image.bytes.byteLength }));
    },
  };
}
