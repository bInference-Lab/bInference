import type { ProtocolClient } from "@binference/client";
import {
  type ImageContentType,
  type ImagePart,
  imageTypeOf,
  maxImageBytes,
  type ProtocolId,
} from "@binference/protocol";

/** The draft's photo as the console shows it: its bytes, and the type their first bytes name. */
export interface DraftPicture {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: ImageContentType;
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** Which draft's photo to read, and its size as `launch/openDraft` gave it. */
interface PictureAsk {
  readonly agent: ProtocolId<"agent">;
  readonly draft: string;
  readonly bytes: number;
}

/**
 * Reads the draft's photo part by part with `launch/draftPicture`, and answers its bytes and the
 * type their first bytes name; none for a photo over 5 MiB, one whose size differs from what the
 * draft said, or one whose first bytes name no PNG, JPEG or WebP. The console never loads it from
 * a URL.
 */
export async function readDraftPicture(
  client: Pick<ProtocolClient, "call">,
  ask: PictureAsk,
  signal: AbortSignal,
): Promise<DraftPicture | null> {
  if (ask.bytes > maxImageBytes) {
    return null;
  }
  const whole = new Uint8Array(ask.bytes);
  const isRead = await readParts(client, { ask, whole, offset: 0 }, signal);
  const contentType = isRead ? imageTypeOf(whole) : undefined;
  return contentType === undefined ? null : { bytes: whole, contentType };
}

// Reads the parts from `offset` into `whole`, each starting where the last one ended; false once a
// part does not fit the size the draft said.
async function readParts(
  client: Pick<ProtocolClient, "call">,
  reading: { readonly ask: PictureAsk; readonly whole: Uint8Array; readonly offset: number },
  signal: AbortSignal,
): Promise<boolean> {
  const { ask, whole, offset } = reading;
  const args = { agent: ask.agent, draft: ask.draft, offset };
  const part: ImagePart = await client.call("launch/draftPicture", args, { signal });
  const data = bytesOf(part.data);
  if (part.bytes !== ask.bytes || part.offset + data.byteLength > ask.bytes) {
    return false;
  }
  whole.set(data, part.offset);
  return part.next === undefined
    ? true
    : readParts(client, { ask, whole, offset: part.next }, signal);
}
