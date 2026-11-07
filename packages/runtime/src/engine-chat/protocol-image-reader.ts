import type { ProtocolClient } from "@binference/client";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { readPagedImage } from "../images/paged-image.js";
import type { ImageReadRefusal } from "../loop/turn-records.js";
import type { HeldOwnerImage, ImagePlace } from "./engine-chat-records.js";
import type { OwnerImageReader } from "./ports.js";

/** The protocol client call the image reader makes. */
export type ImageClient = Pick<ProtocolClient, "call">;

// The engine's refusals of `inbox/readImage`, and Telegram out of reach, which the owner answers
// by sending the image again.
const refusals: ReadonlyMap<string, ImageReadRefusal> = new Map([
  ["image.not_found", "not_found"],
  ["image.too_large", "too_large"],
  ["image.format", "format"],
  ["image.unreadable", "unreadable"],
  ["telegram.unreachable", "unreadable"],
  ["telegram.not_running", "unreadable"],
]);

async function partFrom(
  client: ImageClient,
  part: { readonly place: ImagePlace; readonly offset: number },
  signal: AbortSignal,
) {
  const { place, offset } = part;
  const args = { ...place, ...(offset === 0 ? {} : { offset }) };
  try {
    return ok(await client.call("inbox/readImage", args, { signal }));
  } catch (error) {
    const refusal = error instanceof BinferenceError ? refusals.get(error.code) : undefined;
    if (refusal === undefined) {
      throw error;
    }
    return err(refusal);
  }
}

/**
 * The {@link OwnerImageReader} over the runtime's protocol client: `inbox/readImage` from offset 0
 * until the engine names no next part, the parts joined and checked against the size the engine
 * gave. An answer out of order or over 5 MiB is `unreadable` or `too_large`.
 */
export function createProtocolImageReader(client: ImageClient): OwnerImageReader {
  return {
    async read(place, signal): Promise<Result<HeldOwnerImage, ImageReadRefusal>> {
      signal.throwIfAborted();
      return readPagedImage({
        part: async (offset) => partFrom(client, { place, offset }, signal),
        unreadable: "unreadable",
        tooLarge: "too_large",
      });
    },
  };
}
