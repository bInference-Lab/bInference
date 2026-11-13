import { describe, expect, it } from "vitest";
import { base64urlBytes } from "./base64url-bytes.js";

describe("base64url bytes", () => {
  it("decodes the one text that writes its bytes", () => {
    expect(base64urlBytes("AP8", 2)).toStrictEqual(Uint8Array.of(0, 255));
    expect(base64urlBytes("", 2)).toStrictEqual(new Uint8Array());
  });

  it.each([
    ["padding", "AP8="],
    ["the standard alphabet", "AP+/"],
    ["set bits past the last byte", "AP9"],
    ["a length no bytes give", "AP8AB"],
    ["a space", "AP 8"],
  ])("refuses %s", (_what, text) => {
    expect(base64urlBytes(text, 8)).toBeUndefined();
  });

  it("refuses a text that writes more bytes than it may hold", () => {
    expect(base64urlBytes("AAAA", 2)).toBeUndefined();
    expect(base64urlBytes("AAAA", 3)).toStrictEqual(new Uint8Array(3));
  });
});
