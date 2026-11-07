import type { OwnerCalls } from "@binference/engine/surfaces";
import { fileLimits, protocolIdSchema } from "@binference/protocol";
import type { SentFileReader } from "@binference/telegram";
import { readParts } from "./read-parts.js";
import type { OwnerId } from "./telegram-made-images.js";

/**
 * Reads a file the agent sent, whole, through the engine's `file/fetch` as the owner on Telegram
 * (decision 0400), for the bot to send as a document; `undefined` before the owner pairs, or once
 * the engine no longer holds the file.
 */
export function sentFilesOf(calls: OwnerCalls, ownerId: OwnerId): SentFileReader {
  return async (sent, call) => {
    const senderId = await ownerId(call);
    const agent = protocolIdSchema("agent").safeParse(sent.agent);
    if (senderId === undefined || !agent.success) {
      return undefined;
    }
    return readParts(async (offset) => {
      const args = { agent: agent.data, file: sent.file, ...(offset === 0 ? {} : { offset }) };
      const part = await calls.call({ op: "file/fetch", args, senderId }, call);
      return part.ok ? part.value : undefined;
    }, fileLimits.maxSentFileBytes);
  };
}
