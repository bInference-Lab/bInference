import type { OwnerCalls } from "@binference/engine/surfaces";
import { maxImageBytes, protocolIdSchema } from "@binference/protocol";
import type { MadeImageReader } from "@binference/telegram";
import { readParts } from "./read-parts.js";

/** Answers the owner's numeric Telegram id, once the owner paired. */
export type OwnerId = (call: { readonly signal: AbortSignal }) => Promise<number | undefined>;

/**
 * Reads an image the agent made or showed, whole, through the engine's `image/read` as the owner
 * on Telegram (decision 0392), for the bot to send as a photo; `undefined` before the owner pairs,
 * or once the engine no longer holds the image.
 */
export function madeImagesOf(calls: OwnerCalls, ownerId: OwnerId): MadeImageReader {
  return async (made, call) => {
    const senderId = await ownerId(call);
    const agent = protocolIdSchema("agent").safeParse(made.agent);
    if (senderId === undefined || !agent.success) {
      return undefined;
    }
    return readParts(async (offset) => {
      const args = { agent: agent.data, image: made.image, ...(offset === 0 ? {} : { offset }) };
      const part = await calls.call({ op: "image/read", args, senderId }, call);
      return part.ok ? part.value : undefined;
    }, maxImageBytes);
  };
}
