import type { ProtocolClient } from "@binference/client";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { type ImageContentType, imagePartBytes, maxImageBytes } from "@binference/protocol";
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

// The most parts a 5 MiB image comes in, and one more for an engine that answers less each time.
const maxParts = Math.ceil(maxImageBytes / imagePartBytes) + 1;

interface Received {
  readonly contentType: ImageContentType;
  readonly parts: readonly Uint8Array[];
}

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

// Every part from the first, each starting where the one before said the next one does.
async function partsOf(
  client: ImageClient,
  place: ImagePlace,
  signal: AbortSignal,
): Promise<Result<Received, ImageReadRefusal>> {
  const parts: Uint8Array[] = [];
  let next: number | undefined = 0;
  let contentType: ImageContentType | undefined;
  for (let count = 0; next !== undefined; count += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each part starts where the one before ended
    const part = await partFrom(client, { place, offset: next }, signal);
    if (!part.ok) {
      return part;
    }
    if (part.value.offset !== next || part.value.bytes > maxImageBytes || count >= maxParts) {
      return err(part.value.bytes > maxImageBytes ? "too_large" : "unreadable");
    }
    contentType = part.value.contentType;
    parts.push(Buffer.from(part.value.data, "base64"));
    next = part.value.next;
  }
  return contentType === undefined ? err("unreadable") : ok({ contentType, parts });
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
      const received = await partsOf(client, place, signal);
      if (!received.ok) {
        return received;
      }
      const whole = Buffer.concat(received.value.parts);
      if (whole.byteLength > maxImageBytes) {
        return err("too_large");
      }
      const { contentType } = received.value;
      return ok({ contentType, data: whole.toString("base64"), bytes: whole.byteLength });
    },
  };
}
