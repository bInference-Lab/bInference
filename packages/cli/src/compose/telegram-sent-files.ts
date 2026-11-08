import type { OwnerCalls } from "@binference/engine/surfaces";
import { fileLimits } from "@binference/protocol";
import type { SentFileReader } from "@binference/telegram";
import { readAsOwner } from "./read-parts.js";
import type { OwnerId } from "./telegram-made-images.js";

/**
 * Reads a file the agent sent, whole, through the engine's `file/fetch` as the owner on Telegram
 * (decision 0400), for the bot to send as a document; `undefined` before the owner pairs, or once
 * the engine no longer holds the file.
 */
export function sentFilesOf(calls: OwnerCalls, ownerId: OwnerId): SentFileReader {
  return async (sent, call) =>
    readAsOwner(
      { ownerId, agent: sent.agent, maxBytes: fileLimits.maxSentFileBytes },
      async ({ senderId, agent }, offset) => {
        const args = { agent, file: sent.file, ...offset };
        const part = await calls.call({ op: "file/fetch", args, senderId }, call);
        return part.ok ? part.value : undefined;
      },
      call,
    );
}
