import { describe, expect, it } from "vitest";
import { pictureSizeOf } from "./picture-size.js";

const pngHead = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const ascii = (text: string): readonly number[] => text.split("").map((char) => char.charCodeAt(0));

// A 64 by 48 PNG's header.
const png = new Uint8Array([...pngHead, ...ascii("IHDR"), 0, 0, 0, 64, 0, 0, 0, 48, 8, 6]);
// A JPEG with an APP0 segment, then a baseline frame header of 300 by 200.
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3,
]);
// A lossy WebP of 64 by 48: VP8 chunk, its size, a key frame's tag and start code, then the size.
const lossy = new Uint8Array([
  ...riff,
  ...ascii("VP8 "),
  10,
  0,
  0,
  0,
  0,
  0,
  0,
  0x9d,
  0x01,
  0x2a,
  64,
  0,
  48,
  0,
]);
// A lossless WebP of 64 by 48: VP8L chunk, its size, the signature, then 14 bits less one each.
const lossless = new Uint8Array([...riff, ...ascii("VP8L"), 5, 0, 0, 0, 0x2f, 63, 0xc0, 11, 0]);
// An extended WebP of 64 by 48: VP8X chunk, its size, flags, then 24 bits less one each.
const extended = new Uint8Array([
  ...riff,
  ...ascii("VP8X"),
  10,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  63,
  0,
  0,
  47,
  0,
  0,
]);

/** A picture under test: what it is, its bytes and its type. */
interface Case {
  readonly name: string;
  readonly bytes: Readonly<Uint8Array>;
  readonly type: "image/png" | "image/jpeg" | "image/webp";
}

const small = { width: 64, height: 48 };

describe("a picture's size", () => {
  it.each<Case & { readonly size: { readonly width: number; readonly height: number } }>([
    { name: "a PNG", bytes: png, type: "image/png", size: small },
    {
      name: "a JPEG past its first segment",
      bytes: jpeg,
      type: "image/jpeg",
      size: { width: 300, height: 200 },
    },
    { name: "a lossy WebP", bytes: lossy, type: "image/webp", size: small },
    { name: "a lossless WebP", bytes: lossless, type: "image/webp", size: small },
    { name: "an extended WebP", bytes: extended, type: "image/webp", size: small },
  ])("reads $name from its header", ({ bytes, type, size }) => {
    expect(pictureSizeOf(bytes, type)).toStrictEqual(size);
  });

  it.each<Case>([
    { name: "a PNG cut before its size", bytes: png.slice(0, 20), type: "image/png" },
    { name: "a PNG of no width", bytes: Uint8Array.from(png).fill(0, 16, 20), type: "image/png" },
    { name: "a JPEG with no frame header", bytes: jpeg.slice(0, 8), type: "image/jpeg" },
    {
      name: "a WebP of no chunk it knows",
      bytes: new Uint8Array([...riff, ...ascii("ALPH"), 0, 0]),
      type: "image/webp",
    },
    {
      name: "a lossy WebP that is no key frame",
      bytes: Uint8Array.from(lossy).fill(0, 23, 26),
      type: "image/webp",
    },
  ])("reads no size from $name", ({ bytes, type }) => {
    expect(pictureSizeOf(bytes, type)).toBeUndefined();
  });
});
