import type { ImageContentType } from "@binference/protocol";

// The signatures the three formats open with (protocol spec, section 7.7): PNG's eight bytes,
// JPEG's start-of-image marker, and WebP's RIFF header with `WEBP` at byte 8.
const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpeg = [0xff, 0xd8, 0xff];
const riff = [0x52, 0x49, 0x46, 0x46];
const webp = [0x57, 0x45, 0x42, 0x50];

function opensWith(bytes: Readonly<Uint8Array>, signature: readonly number[], at = 0): boolean {
  return signature.every((byte, index) => bytes[at + index] === byte);
}

/**
 * The format of an image by its first bytes, never by a name or a type a sender declared, or
 * `undefined` for anything but a PNG, a JPEG or a WebP.
 */
export function imageTypeOf(bytes: Readonly<Uint8Array>): ImageContentType | undefined {
  if (opensWith(bytes, png)) {
    return "image/png";
  }
  if (opensWith(bytes, jpeg)) {
    return "image/jpeg";
  }
  return opensWith(bytes, riff) && opensWith(bytes, webp, 8) ? "image/webp" : undefined;
}
