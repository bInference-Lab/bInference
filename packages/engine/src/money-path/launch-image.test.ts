import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { launchImageMaxBytes, launchImageOf } from "./launch-image.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

describe("a launch's picture", () => {
  it.each([
    ["a PNG", png, "image/png"],
    ["a JPEG", jpeg, "image/jpeg"],
    ["a WebP", webp, "image/webp"],
  ])(
    "tells %s by its first bytes, with its size and digest",
    (_case: string, bytes: Readonly<Uint8Array>, contentType: string) => {
      expect(launchImageOf(bytes)).toStrictEqual({
        contentType,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  );

  it("gives the SHA-256 of the bytes themselves", () => {
    expect(launchImageOf(png)?.sha256).toBe(createHash("sha256").update(png).digest("hex"));
  });

  it.each([
    ["a text file", new TextEncoder().encode("hello")],
    [
      "a RIFF file that is no WebP",
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]),
    ],
    ["nothing", new Uint8Array()],
  ])("refuses %s", (_case: string, bytes: Readonly<Uint8Array>) => {
    expect(launchImageOf(bytes)).toBeUndefined();
  });

  it("refuses a picture over 5 MiB", () => {
    const big = new Uint8Array(launchImageMaxBytes + 1);
    big.set(png);
    expect(launchImageOf(big)).toBeUndefined();
  });
});
