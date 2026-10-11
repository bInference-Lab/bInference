import { BinferenceError } from "@binference/core";

/** One file of a tar archive: its path inside it, its size, and its bytes. */
export interface TarFile {
  /** A relative path with `/` between its parts. */
  readonly path: string;
  readonly bytes: number;
  readonly content: AsyncIterable<Uint8Array>;
}

/** The bytes of a tar block. */
export const blockBytes = 512;
// The largest size and the longest name a plain ustar header holds; past either, a PAX record.
const maxPlainSize = 8 ** 11 - 1;
const maxPlainName = 100;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function fieldsOf(name: string, size: number, mtimeS: number): Buffer {
  const block = Buffer.alloc(blockBytes);
  block.write(name, 0, maxPlainName, "utf8");
  block.write(octal(0o600, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(mtimeS, 12), 136, "ascii");
  block.write("ustar\u000000", 257, "ascii");
  return block;
}

/** A ustar header block, its checksum written last over the block with the field as spaces. */
export function headerBlock(
  entry: { readonly name: string; readonly size: number; readonly type: "0" | "x" },
  mtimeS: number,
): Buffer {
  const block = fieldsOf(entry.name, entry.size, mtimeS);
  block.write(entry.type, 156, "ascii");
  block.fill(0x20, 148, 156);
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

/** One PAX record, `<length> <key>=<value>\n`, whose length counts its own digits. */
export function paxRecord(key: string, value: string): Buffer {
  const body = Buffer.from(` ${key}=${value}\n`, "utf8");
  let length = body.length + 1;
  while (String(length).length + body.length !== length) {
    length = String(length).length + body.length;
  }
  return Buffer.concat([Buffer.from(String(length), "ascii"), body]);
}

function padding(size: number): Buffer {
  return Buffer.alloc((blockBytes - (size % blockBytes)) % blockBytes);
}

function needsPax(file: TarFile): boolean {
  const isPlainName = /^[\x20-\x7e]*$/u.test(file.path) && file.path.length <= maxPlainName;
  return !isPlainName || file.bytes > maxPlainSize;
}

function paxHeader(file: TarFile, mtimeS: number): Buffer {
  const records = Buffer.concat([
    paxRecord("path", file.path),
    ...(file.bytes > maxPlainSize ? [paxRecord("size", String(file.bytes))] : []),
  ]);
  const header = headerBlock({ name: "PaxHeader", size: records.length, type: "x" }, mtimeS);
  return Buffer.concat([header, records, padding(records.length)]);
}

function changedSize(file: TarFile, written: number): BinferenceError {
  return new BinferenceError({
    code: "backup.file_changed",
    message: `${file.path} held ${String(written)} bytes where ${String(file.bytes)} were expected; it changed while it was archived.`,
    details: { path: file.path },
  });
}

async function* fileBlocks(file: TarFile, mtimeS: number): AsyncGenerator<Uint8Array> {
  if (needsPax(file)) {
    yield paxHeader(file, mtimeS);
  }
  const name = needsPax(file) ? file.path.slice(0, maxPlainName) : file.path;
  yield headerBlock({ name, size: Math.min(file.bytes, maxPlainSize), type: "0" }, mtimeS);
  let written = 0;
  for await (const piece of file.content) {
    written += piece.length;
    if (written > file.bytes) {
      throw changedSize(file, written);
    }
    yield piece;
  }
  if (written !== file.bytes) {
    throw changedSize(file, written);
  }
  yield padding(file.bytes);
}

/**
 * Writes a POSIX tar archive of regular files, owner-only, all with one modification time: a
 * ustar header for each, a PAX record for a path longer than 100 bytes or outside printable ASCII
 * and for a file of 8 GiB or more, then two empty blocks. A file whose content does not hold
 * exactly its size throws `backup.file_changed`.
 */
export async function* writeTar(
  files: AsyncIterable<TarFile> | Iterable<TarFile>,
  options: { readonly mtimeMs: number },
): AsyncGenerator<Uint8Array, void, undefined> {
  const mtimeS = Math.floor(options.mtimeMs / 1_000);
  for await (const file of files) {
    yield* fileBlocks(file, mtimeS);
  }
  yield Buffer.alloc(2 * blockBytes);
}
