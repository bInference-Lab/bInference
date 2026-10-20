/** A picture's width and height, in pixels. */
export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

type Bytes = Readonly<Uint8Array>;

const at = (bytes: Bytes, index: number): number => bytes[index] ?? 0;
const u16be = (bytes: Bytes, index: number): number =>
  (at(bytes, index) << 8) | at(bytes, index + 1);
const u16le = (bytes: Bytes, index: number): number =>
  at(bytes, index) | (at(bytes, index + 1) << 8);
const u24le = (bytes: Bytes, index: number): number =>
  at(bytes, index) | (at(bytes, index + 1) << 8) | (at(bytes, index + 2) << 16);
const u32be = (bytes: Bytes, index: number): number =>
  u16be(bytes, index) * 65_536 + u16be(bytes, index + 2);

const ascii = (bytes: Bytes, index: number, text: string): boolean =>
  text.split("").every((char, offset) => at(bytes, index + offset) === char.charCodeAt(0));

// A size of at least one pixel each way; anything else is unreadable.
function sizeOf(width: number, height: number): PictureSize | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

// Whether the header holds the bytes a size is read from.
const holds = (bytes: Bytes, end: number): boolean => bytes.byteLength >= end;

// PNG: the IHDR chunk comes first, its width and height big-endian after its type.
function pngSize(bytes: Bytes): PictureSize | undefined {
  return ascii(bytes, 12, "IHDR") && holds(bytes, 24)
    ? sizeOf(u32be(bytes, 16), u32be(bytes, 20))
    : undefined;
}

// A JPEG marker of a frame: SOF0 to SOF15 but DHT (C4), JPG (C8) and DAC (CC).
const isFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
// Markers that stand alone, with no length: TEM and RST0 to RST7.
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

// How far the next JPEG marker is: a fill byte's one, a standalone marker's two, else past the
// segment its length names.
function stepOf(bytes: Bytes, index: number, marker: number): number {
  if (marker === 0xff) {
    return 1;
  }
  return isStandalone(marker) ? 2 : 2 + u16be(bytes, index + 2);
}

// JPEG: the first frame header's height and width, found by stepping over each segment.
function jpegSize(bytes: Bytes): PictureSize | undefined {
  let index = 2;
  while (index + 9 <= bytes.byteLength && at(bytes, index) === 0xff) {
    const marker = at(bytes, index + 1);
    if (isFrameMarker(marker)) {
      return sizeOf(u16be(bytes, index + 7), u16be(bytes, index + 5));
    }
    index += stepOf(bytes, index, marker);
  }
  return undefined;
}

// An extended WebP's VP8X chunk: its canvas width and height less one, 24 bits each.
function extendedSize(bytes: Bytes): PictureSize | undefined {
  return holds(bytes, 30) ? sizeOf(1 + u24le(bytes, 24), 1 + u24le(bytes, 27)) : undefined;
}

// A lossless WebP's VP8L chunk: after its signature, width and height less one, 14 bits each.
function losslessSize(bytes: Bytes): PictureSize | undefined {
  if (at(bytes, 20) !== 0x2f || !holds(bytes, 25)) {
    return undefined;
  }
  const [b0, b1, b2, b3] = [at(bytes, 21), at(bytes, 22), at(bytes, 23), at(bytes, 24)];
  const width = 1 + (((b1 & 0x3f) << 8) | b0);
  const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
  return sizeOf(width, height);
}

// A lossy WebP's VP8 chunk: a key frame's start code, then its width and height, 14 bits each.
function lossySize(bytes: Bytes): PictureSize | undefined {
  const isKeyFrame = at(bytes, 23) === 0x9d && at(bytes, 24) === 0x01 && at(bytes, 25) === 0x2a;
  return isKeyFrame && holds(bytes, 30)
    ? sizeOf(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff)
    : undefined;
}

// WebP: its first chunk, lossy (VP8), lossless (VP8L) or extended (VP8X), holds the size.
function webpSize(bytes: Bytes): PictureSize | undefined {
  if (ascii(bytes, 12, "VP8X")) {
    return extendedSize(bytes);
  }
  if (ascii(bytes, 12, "VP8L")) {
    return losslessSize(bytes);
  }
  return ascii(bytes, 12, "VP8 ") ? lossySize(bytes) : undefined;
}

const readers: {
  readonly [T in "image/png" | "image/jpeg" | "image/webp"]: (
    bytes: Bytes,
  ) => PictureSize | undefined;
} = { "image/png": pngSize, "image/jpeg": jpegSize, "image/webp": webpSize };

/**
 * A picture's width and height from its header, by its type: PNG's IHDR chunk, JPEG's first frame
 * header, WebP's VP8, VP8L or VP8X chunk. A header it cannot read, or a side of no pixels, is
 * `undefined`.
 */
export function pictureSizeOf(
  bytes: Bytes,
  contentType: "image/png" | "image/jpeg" | "image/webp",
): PictureSize | undefined {
  return readers[contentType](bytes);
}
