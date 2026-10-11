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
  const gzip = gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION });
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
