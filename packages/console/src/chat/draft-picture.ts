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

/** Reads one part of a picture from `offset`, as `launch/draftPicture` and `image/read` answer. */
export type PictureParts = (offset: number, signal: AbortSignal) => Promise<ImagePart>;

/**
 * Reads a picture of `bytes` bytes part by part, and answers its bytes and the type their first
 * bytes name; none for a picture over 5 MiB, one whose size differs from `bytes`, or one whose
 * first bytes name no PNG, JPEG or WebP. The console never loads a picture from a URL.
 */
export async function readPicture(
  parts: PictureParts,
  bytes: number,
  signal: AbortSignal,
): Promise<DraftPicture | null> {
  if (bytes > maxImageBytes) {
    return null;
  }
  const whole = new Uint8Array(bytes);
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each part starts where the last ended
    const part: ImagePart = await parts(offset, signal);
    const data = bytesOf(part.data);
    if (part.bytes !== bytes || part.offset + data.byteLength > bytes) {
      return null;
    }
    whole.set(data, part.offset);
    offset = part.next;
  }
  const contentType = imageTypeOf(whole);
  return contentType === undefined ? null : { bytes: whole, contentType };
}

/**
 * Reads the draft's photo part by part with `launch/draftPicture`, as {@link readPicture} reads
 * a picture.
 */
export async function readDraftPicture(
  client: Pick<ProtocolClient, "call">,
  ask: PictureAsk,
  signal: AbortSignal,
): Promise<DraftPicture | null> {
  const parts: PictureParts = async (offset, partSignal) =>
    client.call(
      "launch/draftPicture",
      { agent: ask.agent, draft: ask.draft, offset },
      { signal: partSignal },
    );
  return readPicture(parts, ask.bytes, signal);
}
