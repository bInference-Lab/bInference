import { describe, expect, it } from "vitest";
import { imageTypeOf } from "./image-type.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("imageTypeOf", () => {
  it("reads PNG, JPEG and WebP from their first bytes", () => {
    expect([png, jpeg, webp].map(imageTypeOf)).toStrictEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  });

  it("reads nothing else, a RIFF file that is not WebP among them", () => {
    const wave = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const gif = new TextEncoder().encode("GIF89a");
    expect([wave, gif, new Uint8Array(0)].map(imageTypeOf)).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
