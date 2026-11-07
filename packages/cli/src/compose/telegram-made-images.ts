import type { Result } from "@binference/core";
import type { OwnerCalls } from "@binference/engine/surfaces";
import {
  type ArgsOf,
  maxImageBytes,
  type ProtocolErrorCode,
  protocolIdSchema,
  type ResultOf,
} from "@binference/protocol";
import type { MadeImageReader } from "@binference/telegram";

/**
 * Reads an image the agent made, whole, through the engine's `image/read` as the owner on Telegram
 * (decision 0392), for the bot to send as a photo; `undefined` before the owner pairs, or once the
 * engine no longer holds the image.
 */
export function madeImagesOf(
  calls: OwnerCalls,
  ownerId: (call: { readonly signal: AbortSignal }) => Promise<number | undefined>,
): MadeImageReader {
  return async (made, call) => {
    const senderId = await ownerId(call);
    const agent = protocolIdSchema("agent").safeParse(made.agent);
    if (senderId === undefined || !agent.success) {
      return undefined;
    }
    const pieces: Buffer[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined && offset < maxImageBytes) {
      const args: ArgsOf<"image/read"> = {
        agent: agent.data,
        image: made.image,
        ...(offset === 0 ? {} : { offset }),
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- the engine answers the parts in order
      const part: Result<ResultOf<"image/read">, ProtocolErrorCode> = await calls.call(
        { op: "image/read", args, senderId },
        call,
      );
      if (!part.ok) {
        return undefined;
      }
      pieces.push(Buffer.from(part.value.data, "base64"));
      offset = part.value.next;
    }
    return new Uint8Array(Buffer.concat(pieces));
  };
}
