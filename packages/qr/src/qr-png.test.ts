import { inflateSync } from "node:zlib";
import { decodeQR } from "qr/decode.js";
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-modules.js";
import { qrPng } from "./qr-png.js";

const evmAddress = "0x52908400098527886E0F7030069857D2E4169EE7";
const solanaAddress = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

// The PNG's chunks by type, each checked against its length.
function chunksOf(png: Readonly<Uint8Array>): ReadonlyMap<string, Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = new Map<string, Uint8Array>();
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    chunks.set(type, png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return chunks;
}

// The PNG's pixels as an RGBA image, unpacked the way an image viewer reads them.
function imageOf(png: Readonly<Uint8Array>): { width: number; height: number; data: Uint8Array } {
  const chunks = chunksOf(png);
  const header = new DataView((chunks.get("IHDR") ?? new Uint8Array(13)).slice().buffer);
  const side = header.getUint32(0);
  const raw = inflateSync(chunks.get("IDAT") ?? new Uint8Array());
  const rowBytes = 1 + Math.ceil(side / 8);
  const data = new Uint8Array(side * side * 4);
  for (let index = 0; index < side * side; index += 1) {
    const [y, x] = [Math.floor(index / side), index % side];
    const isWhite = ((raw[y * rowBytes + 1 + (x >>> 3)] ?? 0) & (0x80 >>> (x & 7))) !== 0;
    data.fill(isWhite ? 255 : 0, index * 4, index * 4 + 3);
    data[index * 4 + 3] = 255;
  }
  return { width: side, height: side, data };
}

describe("the QR code of an address", () => {
  it.each([
    ["an EVM address, its checksum case kept", evmAddress],
    ["a Solana address", solanaAddress],
  ])("decodes back to %s exactly", (_case, address) => {
    expect(decodeQR(imageOf(qrPng(address)))).toBe(address);
  });

  it("is a 1-bit grayscale PNG, 16 pixels a module, quiet zone included", () => {
    const png = qrPng(evmAddress);
    const header = chunksOf(png).get("IHDR");
    const side = qrModules(evmAddress).length * 16;
    expect([...png.subarray(0, 8)]).toStrictEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(header).toStrictEqual(
      Uint8Array.from([0, 0, side >> 8, side & 255, 0, 0, side >> 8, side & 255, 1, 0, 0, 0, 0]),
    );
    expect(qrModules(evmAddress)[0]?.every((module) => !module)).toBe(true);
  });

  it("stays small enough for any chat app", () => {
    expect(qrPng(evmAddress).length).toBeLessThan(100_000);
  });
});
