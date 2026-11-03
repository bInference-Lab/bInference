import { imagePartBytes, type ImagePart } from "@binference/protocol";
import type { HeldImage } from "./image-hold.js";

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
