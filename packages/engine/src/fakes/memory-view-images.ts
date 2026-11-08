import { err, ok } from "@binference/core";
import { maxImageBytes } from "@binference/protocol";
import type { ViewImageSource } from "../chat/ports.js";

/**
 * An in-memory {@link ViewImageSource} for tests: the images it is given by address or path, a
 * path under `walledFolder` `walled`, an address on `private.invalid` `not_public`, any other
 * place `not_found`, and one over `maxBytes`, 5 MiB when absent, `too_large`.
 */
export function createMemoryViewImages(
  images: ReadonlyMap<string, Uint8Array>,
  walledFolder = "/state",
): ViewImageSource {
  return {
    async read(place, options) {
      options.signal.throwIfAborted();
      const name = "url" in place ? place.url : place.path;
      if ("path" in place && place.path.startsWith(`${walledFolder}/`)) {
        return Promise.resolve(err("walled"));
      }
      if ("url" in place && new URL(place.url).hostname.endsWith("private.invalid")) {
        return Promise.resolve(err("not_public"));
      }
      const bytes = images.get(name);
      if (bytes === undefined) {
        return Promise.resolve(err("not_found"));
      }
      const most = options.maxBytes ?? maxImageBytes;
      return Promise.resolve(bytes.byteLength > most ? err("too_large") : ok(bytes));
    },
  };
}
