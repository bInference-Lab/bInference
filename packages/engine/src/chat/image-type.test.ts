import { describe, expect, it } from "vitest";
import { imageTypeOf } from "./image-type.js";
import { testImageHeads, testPng } from "./test-images.js";

describe("imageTypeOf", () => {
  it("reads PNG, JPEG and WebP from their first bytes", () => {
    expect([testPng, testImageHeads.jpeg, testImageHeads.webp].map(imageTypeOf)).toStrictEqual([
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
