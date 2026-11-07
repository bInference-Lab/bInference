import { err, ok, type Result } from "@binference/core";
import {
  type ImageContentType,
  type ImagePart,
  imagePartBytes,
  maxImageBytes,
} from "@binference/protocol";

/** One image whole, as the engine answered it part by part. */
export interface PagedImage {
  readonly contentType: ImageContentType;
  /** The image's bytes in base64. */
  readonly data: string;
  readonly bytes: number;
}

/** How a paged read reads one part, and the refusals it answers for a broken or large answer. */
export interface PagedRead<E extends string> {
  /** Reads the part that starts at `offset`, or the engine's refusal of it. */
  readonly part: (offset: number) => Promise<Result<ImagePart, E>>;
  readonly unreadable: E;
  readonly tooLarge: E;
}

// The most parts a 5 MiB image comes in, and one more for an engine that answers less each time.
const maxParts = Math.ceil(maxImageBytes / imagePartBytes) + 1;

/**
 * Reads an image the engine answers in parts, from offset 0 until a part names no next one: each
 * part must start where the one before said, and the whole must stay within 5 MiB. An answer out
 * of order is `unreadable`, one over 5 MiB `tooLarge`.
 */
export async function readPagedImage<E extends string>(
  read: PagedRead<E>,
): Promise<Result<PagedImage, E>> {
  const parts: Uint8Array[] = [];
  let next: number | undefined = 0;
  let contentType: ImageContentType | undefined;
  for (let count = 0; next !== undefined; count += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each part starts where the one before ended
    const part = await read.part(next);
    if (!part.ok) {
      return part;
    }
    if (part.value.bytes > maxImageBytes) {
      return err(read.tooLarge);
    }
    if (part.value.offset !== next || count >= maxParts) {
      return err(read.unreadable);
    }
    contentType = part.value.contentType;
    parts.push(Buffer.from(part.value.data, "base64"));
    next = part.value.next;
  }
  const whole = Buffer.concat(parts);
  if (whole.byteLength > maxImageBytes) {
    return err(read.tooLarge);
  }
  return contentType === undefined
    ? err(read.unreadable)
    : ok({ contentType, data: whole.toString("base64"), bytes: whole.byteLength });
}
