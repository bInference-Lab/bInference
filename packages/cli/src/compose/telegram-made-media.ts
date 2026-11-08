import type { OwnerCalls } from "@binference/engine/surfaces";
import { maxVideoBytes } from "@binference/protocol";
import type { MediaReader } from "@binference/telegram";
import { readAsOwner } from "./read-parts.js";
import type { OwnerId } from "./telegram-made-images.js";

/**
 * Reads a video or speech the agent made, whole, through the engine's `media/read` as the owner on
 * Telegram (decision 0405), for the bot to send as a video or a voice note; `undefined` before the
 * owner pairs, or once the engine no longer holds it.
 */
export function madeMediaOf(calls: OwnerCalls, ownerId: OwnerId): MediaReader {
  return async (made, call) =>
    readAsOwner(
      { ownerId, agent: made.agent, maxBytes: maxVideoBytes },
      async ({ senderId, agent }, offset) => {
        const args = { agent, media: made.media, ...offset };
        const part = await calls.call({ op: "media/read", args, senderId }, call);
        return part.ok ? part.value : undefined;
      },
      call,
    );
}
