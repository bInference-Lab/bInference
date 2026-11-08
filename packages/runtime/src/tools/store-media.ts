import { type MediaKind, mediaPartBytes, type MediaView } from "@binference/protocol";
import type { AgentToolParts } from "./tool-client.js";

/**
 * Sends a video or speech the runtime made to the engine in parts of 512 KiB, in order, through
 * `media/store` (decision 0405), and answers the medium the engine saved in the workspace. Rejects
 * with the engine's refusal, such as `media.too_large`.
 */
export async function storeMedia(
  parts: Pick<AgentToolParts, "agent" | "client">,
  medium: { readonly job: string; readonly kind: MediaKind; readonly bytes: Uint8Array },
  signal: AbortSignal,
): Promise<MediaView | undefined> {
  const { agent, client } = parts;
  const { job, kind, bytes } = medium;
  const total = bytes.byteLength;
  let saved: MediaView | undefined;
  for (let offset = 0; offset < total; offset += mediaPartBytes) {
    const data = Buffer.from(bytes.subarray(offset, offset + mediaPartBytes)).toString("base64");
    const args = { agent, job, kind, offset, total, data };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the engine takes the parts in order
    const stored = await client.call("media/store", args, { signal });
    saved = stored.media;
  }
  return saved;
}
