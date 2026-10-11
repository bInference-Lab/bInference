import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chunkAad, chunkNonce, openChunk, sealChunk } from "./chunk-cipher.js";

// Known answers computed apart from this code, with node:crypto's AES-256-GCM over a nonce and
// associated data laid out by hand as keys spec section 7.2 says.
const dataKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const noncePrefix = Buffer.from("a0a1a2a3a4a5a6a7", "hex");
const headerDigest = createHash("sha256").update("binference-backup kat").digest();
const frame = { noncePrefix, headerDigest };
const known = {
  digest: "97cf8d618b6a3c85b354725f9b67decd10e606592783eefae5b05661c80a0efc",
  first: "9d319bc63a120840a510a6eac0ca67076d4d0e59a258198777f0",
  lastFinal: "50eb224a1f7007bfa6db64ebd9b4192c85a53ebe774f823992",
  lastNotFinal: "50eb224a1f7007bfa69e0bcb24f3851fe31ceda08edad8c8b6",
};
const text = (value: string): Buffer => Buffer.from(value, "utf8");

describe("a backup chunk's framing", () => {
  it("lays the nonce out as the prefix, then the chunk's number in four bytes, big-endian", () => {
    expect(chunkNonce(noncePrefix, 0).toString("hex")).toBe("a0a1a2a3a4a5a6a700000000");
    expect(chunkNonce(noncePrefix, 258).toString("hex")).toBe("a0a1a2a3a4a5a6a700000102");
    expect(chunkNonce(noncePrefix, 2 ** 32 - 1).toString("hex")).toBe("a0a1a2a3a4a5a6a7ffffffff");
  });

  it("lays the associated data out as the header's digest, the number, then the final flag", () => {
    expect(headerDigest.toString("hex")).toBe(known.digest);
    expect(chunkAad(headerDigest, { index: 1, isFinal: false }).toString("hex")).toBe(
      `${known.digest}0000000100`,
    );
    expect(chunkAad(headerDigest, { index: 1, isFinal: true }).toString("hex")).toBe(
      `${known.digest}0000000101`,
    );
  });

  it("refuses a chunk number past four bytes", () => {
    expect(() => chunkNonce(noncePrefix, 2 ** 32)).toThrow(/at most/u);
    expect(() => chunkNonce(noncePrefix, -1)).toThrow(/at most/u);
  });

  it("seals each chunk to the known answer", () => {
    const first = { place: { index: 0, isFinal: false }, plaintext: text("chunk zero") };
    const last = { place: { index: 1, isFinal: true }, plaintext: text("chunk one") };
    const lastNotFinal = { ...last, place: { index: 1, isFinal: false } };

    expect(sealChunk(dataKey, frame, first).toString("hex")).toBe(known.first);
    expect(sealChunk(dataKey, frame, last).toString("hex")).toBe(known.lastFinal);
    expect(sealChunk(dataKey, frame, lastNotFinal).toString("hex")).toBe(known.lastNotFinal);
  });

  it("opens the known answer at its place", () => {
    const sealed = Buffer.from(known.lastFinal, "hex");

    const opened = openChunk(dataKey, frame, { place: { index: 1, isFinal: true }, sealed });

    expect(opened?.toString("utf8")).toBe("chunk one");
  });

  it("opens nothing at another place, under another header, key or flag, or with a changed byte", () => {
    const sealed = Buffer.from(known.lastFinal, "hex");
    const at = { index: 1, isFinal: true };
    const flipped = Buffer.from(sealed);
    flipped.writeUInt8(flipped.readUInt8(3) ^ 0x80, 3);
    const otherDigest = createHash("sha256").update("another header").digest();

    expect(
      openChunk(dataKey, frame, { place: { index: 0, isFinal: true }, sealed }),
    ).toBeUndefined();
    expect(
      openChunk(dataKey, frame, { place: { index: 1, isFinal: false }, sealed }),
    ).toBeUndefined();
    expect(
      openChunk(dataKey, { ...frame, headerDigest: otherDigest }, { place: at, sealed }),
    ).toBeUndefined();
    expect(openChunk(Buffer.alloc(32, 7), frame, { place: at, sealed })).toBeUndefined();
    expect(openChunk(dataKey, frame, { place: at, sealed: flipped })).toBeUndefined();
    expect(
      openChunk(dataKey, frame, { place: at, sealed: sealed.subarray(0, 15) }),
    ).toBeUndefined();
  });
});
