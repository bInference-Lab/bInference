import type { LaunchImage } from "../intents/token-launch-quote.js";
import { sha256HexOfBytes } from "../records/sha256-hex.js";

/** The largest picture a launch uploads: 5 MiB, as every upload (protocol spec, section 7.9). */
export const launchImageMaxBytes: number = 5 * 1024 * 1024;

type ImageType = LaunchImage["contentType"];

// Each format by the bytes it starts with; WebP's RIFF header names it at byte 8.
const signatures: readonly {
  readonly type: ImageType;
  readonly at: number;
  readonly bytes: readonly number[];
}[] = [
  { type: "image/png", at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", at: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: "image/webp", at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
];

function typeOf(bytes: Readonly<Uint8Array>): ImageType | undefined {
  const isRiff = [0x52, 0x49, 0x46, 0x46].every((byte, index) => bytes[index] === byte);
  return signatures.find(
    (signature) =>
      (signature.type !== "image/webp" || isRiff) &&
      signature.bytes.every((byte, index) => bytes[signature.at + index] === byte),
  )?.type;
}

/**
 * A launch's picture as its quote keeps it (decision 0234): a PNG, JPEG or WebP, told by its first
 * bytes, of at most 5 MiB, with the SHA-256 of its bytes. Anything else is `undefined`.
 */
export function launchImageOf(bytes: Readonly<Uint8Array>): LaunchImage | undefined {
  const contentType = typeOf(bytes);
  return contentType === undefined || bytes.byteLength > launchImageMaxBytes
    ? undefined
    : { contentType, bytes: bytes.byteLength, sha256: sha256HexOfBytes(bytes) };
}
