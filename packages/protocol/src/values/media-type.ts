import type { MediaContentType, MediaKind } from "../operations/media-operations.schema.js";

// The signatures the formats open with: an MP4 or M4A's `ftyp` box at byte 4, Ogg's `OggS`, and
// an MP3's ID3 tag or the sync bits of its first frame.
const ftyp = [0x66, 0x74, 0x79, 0x70];
const ogg = [0x4f, 0x67, 0x67, 0x53];
const id3 = [0x49, 0x44, 0x33];

function opensWith(bytes: Readonly<Uint8Array>, signature: readonly number[], at = 0): boolean {
  return signature.every((byte, index) => bytes[at + index] === byte);
}

function isMp3Frame(bytes: Readonly<Uint8Array>): boolean {
  const second = bytes[1] ?? 0;
  return bytes[0] === 0xff && (second & 0xe0) === 0xe0;
}

function speechTypeOf(bytes: Readonly<Uint8Array>): MediaContentType | undefined {
  if (opensWith(bytes, ogg)) {
    return "audio/ogg";
  }
  if (opensWith(bytes, id3) || isMp3Frame(bytes)) {
    return "audio/mpeg";
  }
  return opensWith(bytes, ftyp, 4) ? "audio/mp4" : undefined;
}

/**
 * The format of a made medium by its first bytes, never by a name or a declared type (decision
 * 0405): a video is an MP4; speech is Ogg, MP3 or M4A; `undefined` for anything else.
 */
export function mediaTypeOf(
  bytes: Readonly<Uint8Array>,
  kind: MediaKind,
): MediaContentType | undefined {
  if (kind === "voice") {
    return speechTypeOf(bytes);
  }
  return opensWith(bytes, ftyp, 4) ? "video/mp4" : undefined;
}
