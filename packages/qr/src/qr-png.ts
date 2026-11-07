import { type QrModules, qrModules } from "./qr-modules.js";

// Each module is this many pixels a side, so the code of an EVM address is about 650 pixels wide.
const modulePixels = 16;
// The most bytes one stored deflate block holds.
const storedBlockBytes = 65_535;

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crcTable = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Readonly<Uint8Array>): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function adler32(bytes: Readonly<Uint8Array>): number {
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % 65_521;
    high = (high + low) % 65_521;
  }
  return ((high << 16) | low) >>> 0;
}

function uint32(value: number): readonly number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Readonly<Uint8Array>): readonly number[] {
  const typed = Uint8Array.from([...Array.from(type, (letter) => letter.charCodeAt(0)), ...data]);
  return [...uint32(data.length), ...typed, ...uint32(crc32(typed))];
}

// The pixels as zlib data in stored blocks: a code is mostly runs of one colour, but at one bit a
// pixel it is small enough to need no compression, and no compressor has to ship with it.
function storedZlib(raw: Readonly<Uint8Array>): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  for (let start = 0; start < raw.length || start === 0; start += storedBlockBytes) {
    const part = raw.subarray(start, start + storedBlockBytes);
    const isLast = start + storedBlockBytes >= raw.length ? 1 : 0;
    blocks.push(isLast, part.length & 0xff, part.length >>> 8);
    blocks.push(~part.length & 0xff, (~part.length >>> 8) & 0xff, ...part);
  }
  return Uint8Array.from([...blocks, ...uint32(adler32(raw))]);
}

// One row of one-bit pixels for each pixel row of the code, each led by filter byte 0 (none); a
// set bit is white, as PNG's grayscale counts.
function pixelRows(modules: QrModules): Uint8Array {
  const side = modules.length * modulePixels;
  const rowBytes = 1 + Math.ceil(side / 8);
  const raw = new Uint8Array(rowBytes * side);
  modules.forEach((row, y) => {
    const line = new Uint8Array(rowBytes);
    for (let x = 0; x < side; x += 1) {
      const isDark = row[Math.floor(x / modulePixels)] === true;
      line[1 + (x >>> 3)] = (line[1 + (x >>> 3)] ?? 0) | (isDark ? 0 : 0x80 >>> (x & 7));
    }
    for (let repeat = 0; repeat < modulePixels; repeat += 1) {
      raw.set(line, (y * modulePixels + repeat) * rowBytes);
    }
  });
  return raw;
}

/**
 * A PNG of the QR code that holds `text` exactly (see {@link qrModules}): black modules on white,
 * one bit a pixel, 16 pixels a module. It runs the same in Node and in a browser, so a chat app
 * can upload it and a web page can show it as a `data:` URL.
 */
export function qrPng(text: string): Uint8Array {
  const modules = qrModules(text);
  const side = modules.length * modulePixels;
  // Width, height, 1-bit depth, grayscale, then the standard compression, filter and no interlace.
  const header = Uint8Array.from([...uint32(side), ...uint32(side), 1, 0, 0, 0, 0]);
  return Uint8Array.from([
    ...pngSignature,
    ...chunk("IHDR", header),
    ...chunk("IDAT", storedZlib(pixelRows(modules))),
    ...chunk("IEND", new Uint8Array()),
  ]);
}
