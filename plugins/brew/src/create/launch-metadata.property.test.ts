import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { launchMetadataOf, pictureBytesFor } from "./launch-metadata.js";

// BrewFactory takes a metadata address of at most 2,048 bytes.
const mostBytes = 2_048;
const bytesOf = (text: string): number => new TextEncoder().encode(text).byteLength;

// Words within Brew's limits, of characters JSON escapes or UTF-8 widens among others: a quote, a
// backslash, a line break, and two-, three- and four-byte characters.
const units = [
  "a",
  '"',
  "\\",
  "\n",
  ...[0xe9, 0x732b, 0x1f431].map((code) => String.fromCodePoint(code)),
];
const text = (most: number) => fc.string({ unit: fc.constantFrom(...units), maxLength: most });
const wordsOf = fc.record({
  name: fc.constant("Moon Cat"),
  symbol: fc.constant("MCAT"),
  description: text(150),
  links: fc.record({ website: text(25), x: text(25), telegram: text(25) }),
});
const typeOf = fc.constantFrom("image/png", "image/jpeg", "image/webp");

const pictureOf = (contentType: string, bytes: number) => ({
  contentType,
  bytes: new Uint8Array(bytes).fill(0xff),
});

describe("the picture bytes a Brew launch takes beside its words", () => {
  it("fit the metadata address in every picture type", () => {
    fc.assert(
      fc.property(wordsOf, typeOf, (words, type) => {
        const metadata = launchMetadataOf(words, pictureOf(type, pictureBytesFor(words)));
        expect(bytesOf(metadata)).toBeLessThanOrEqual(mostBytes);
      }),
    );
  });

  it("are the most that fit: one more byte in the longest type does not", () => {
    fc.assert(
      fc.property(wordsOf, (words) => {
        const over = pictureOf("image/webp", pictureBytesFor(words) + 1);
        expect(bytesOf(launchMetadataOf(words, over))).toBeGreaterThan(mostBytes);
      }),
    );
  });
});
