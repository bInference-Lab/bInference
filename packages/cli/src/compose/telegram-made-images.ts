import type { OwnerCalls } from "@binference/engine/surfaces";
import { maxImageBytes } from "@binference/protocol";
import type { MadeImageReader } from "@binference/telegram";
import { readAsOwner } from "./read-parts.js";

/** Answers the owner's numeric Telegram id, once the owner paired. */
export type OwnerId = (call: { readonly signal: AbortSignal }) => Promise<number | undefined>;

/**
 * Reads an image the agent made or showed, whole, through the engine's `image/read` as the owner
 * on Telegram (decision 0392), for the bot to send as a photo; `undefined` before the owner pairs,
 * or once the engine no longer holds the image.
 */
export function madeImagesOf(calls: OwnerCalls, ownerId: OwnerId): MadeImageReader {
  return async (made, call) =>
    readAsOwner(
      { ownerId, agent: made.agent, maxBytes: maxImageBytes },
      async ({ senderId, agent }, offset) => {
        const args = { agent, image: made.image, ...offset };
        const part = await calls.call({ op: "image/read", args, senderId }, call);
        return part.ok ? part.value : undefined;
      },
      call,
    );
}
