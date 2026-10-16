import { err, ok } from "@binference/core";
import { maxImageBytes } from "@binference/protocol";
import type { OwnerImageSource } from "../chat/ports.js";

/**
 * An in-memory {@link OwnerImageSource} for tests over the images it is given, by name: one over
 * 5 MiB is `too_large`, a name it does not hold `unreadable`.
 */
export function createMemoryOwnerImages(images: ReadonlyMap<string, Uint8Array>): OwnerImageSource {
  return {
    async read(image, options) {
      options.signal.throwIfAborted();
      const bytes = images.get(image);
      if (bytes === undefined) {
        return Promise.resolve(err("unreadable"));
      }
      return Promise.resolve(bytes.byteLength > maxImageBytes ? err("too_large") : ok(bytes));
    },
  };
}
