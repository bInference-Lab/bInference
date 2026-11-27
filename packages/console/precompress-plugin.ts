// oxlint-disable-next-line eslint/no-restricted-imports -- the build runs in Node and writes compressed copies beside its own output; the page never loads this
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Plugin } from "vite";

// Text files compress well; fonts and images are compressed already.
const compressible = new Set([".html", ".js", ".css", ".svg", ".json", ".txt"]);
// Below this, a compressed copy saves less than its own headers cost.
const smallestBytes = 1024;

async function filesUnder(folder: string): Promise<readonly string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && compressible.has(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));
}

// RFC 1952 puts the file's time in header bytes 4 to 7 and the system that wrote it in byte 9.
// zlib writes the system it was built for (3 on Linux, 19 on macOS), so the same build differed by
// machine; a zero time and 255, "unknown", hold on every one.
const timeBytes = { start: 4, end: 8 };
const systemByte = 9;
const unknownSystem = 0xff;

/**
 * The gzip copy of a file's bytes at the best compression, with no time and no system in its
 * header, so every machine writes the same bytes from the same file.
 */
export function gzipCopy(bytes: Uint8Array): Uint8Array {
  const gzip = new Uint8Array(gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION }));
  gzip.fill(0, timeBytes.start, timeBytes.end);
  gzip[systemByte] = unknownSystem;
  return gzip;
}

async function compress(file: string): Promise<void> {
  const bytes = await readFile(file);
  if (bytes.byteLength < smallestBytes) {
    return;
  }
  const brotli = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  });
  const gzip = gzipCopy(bytes);
  await Promise.all([
    brotli.byteLength < bytes.byteLength ? writeFile(`${file}.br`, brotli) : undefined,
    gzip.byteLength < bytes.byteLength ? writeFile(`${file}.gz`, gzip) : undefined,
  ]);
}

/**
 * Writes a Brotli (`.br`) and a gzip (`.gz`) copy beside each text file of the build of 1 KiB or
 * more, each at its best compression and only when smaller, so the engine sends a file in the
 * coding a browser takes without compressing it on each request.
 */
export function precompress(outDir: string): Plugin {
  return {
    name: "binference-precompress",
    apply: "build",
    async closeBundle() {
      const files = await filesUnder(outDir);
      await Promise.all(files.map(compress));
    },
  };
}
