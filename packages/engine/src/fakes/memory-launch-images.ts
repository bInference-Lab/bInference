import { err, ok } from "@binference/core";
import type { LaunchImageSource } from "../money-path/ports.js";

/**
 * Creates a {@link LaunchImageSource} over uploads held in memory, by upload id, for tests. It
 * hands out a copy of each, so a reader cannot change what it holds.
 */
export function createMemoryLaunchImages(
  uploads: ReadonlyMap<string, Readonly<Uint8Array>>,
): LaunchImageSource {
  return {
    async read(image, { signal }) {
      signal.throwIfAborted();
      const bytes = uploads.get(image);
      return await Promise.resolve(
        bytes === undefined ? err("unreadable" as const) : ok(Uint8Array.from(bytes)),
      );
    },
  };
}
