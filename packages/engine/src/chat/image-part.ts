import { err, ok, type Result } from "@binference/core";
import { imagePartBytes, type ImagePart, type ProtocolErrorCode } from "@binference/protocol";
import type { HeldImage, HoldRefusal, ImageHold } from "./image-hold.js";

/**
 * The part of an image from `offset`, as `inbox/readImage` and `launch/draftPicture` answer it: at
 * most 512 KiB, in base64, with where the next part starts. The caller checks the offset is inside
 * the image.
 */
export function imagePartOf(image: HeldImage, offset: number): ImagePart {
  const end = Math.min(image.bytes.byteLength, offset + imagePartBytes);
  const data = Buffer.from(image.bytes.subarray(offset, end)).toString("base64");
  const { contentType } = image;
  const bytes = image.bytes.byteLength;
  return { contentType, bytes, offset, data, ...(end < bytes ? { next: end } : {}) };
}

/** A hold and the error code each of its refusals answers with. */
export interface PartSource<R extends string> {
  readonly hold: ImageHold<R>;
  readonly codes: Readonly<Record<HoldRefusal<R>, ProtocolErrorCode>>;
}

/** One part of a held image: the image's key in the hold, its name for the source, the offset. */
export interface HeldPartPlace {
  readonly key: string;
  readonly image: string;
  readonly offset: number;
}

/**
 * The part of a held image from `offset`, read through the hold, which lets the image go once its
 * last part is read. A refusal answers its code; an offset past the image is `protocol.bad_args`.
 */
export async function readHeldPart<R extends string>(
  from: PartSource<R>,
  place: HeldPartPlace,
  options: { readonly signal: AbortSignal },
): Promise<Result<ImagePart, ProtocolErrorCode>> {
  const read = await from.hold.read(place.key, place.image, options);
  if (!read.ok) {
    return err(from.codes[read.error]);
  }
  if (place.offset >= read.value.bytes.byteLength) {
    return err("protocol.bad_args");
  }
  const part = imagePartOf(read.value, place.offset);
  if (part.next === undefined) {
    from.hold.drop(place.key);
  }
  return ok(part);
}
