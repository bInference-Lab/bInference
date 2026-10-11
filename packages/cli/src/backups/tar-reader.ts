import { BinferenceError } from "@binference/core";
import { createByteReader, type ByteReader } from "./byte-reader.js";
import { blockBytes } from "./tar-writer.js";

/** A file of a tar archive as it is read: its path and size. */
export interface TarEntry {
  readonly path: string;
  readonly bytes: number;
}

/** Takes one file's bytes as they are read; it must read them all before it returns. */
export type TarFileHandler = (entry: TarEntry, content: AsyncIterable<Uint8Array>) => Promise<void>;

const pieceBytes = 65_536;

function broken(why: string): BinferenceError {
  return new BinferenceError({
    code: "backup.archive_damaged",
    message: `The backup's archive cannot be read: ${why}.`,
  });
}

function textOf(block: Uint8Array, start: number, length: number): string {
  const field = Buffer.from(block.subarray(start, start + length));
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? length : end).toString("utf8");
}

function numberOf(block: Uint8Array, start: number, length: number): number {
  const text = textOf(block, start, length).trim();
  if (!/^[0-7]+$/u.test(text)) {
    throw broken("a header holds a number that is not octal");
  }
  return Number.parseInt(text, 8);
}

function checksumOf(block: Uint8Array): number {
  return block.reduce(
    (total, byte, index) => total + (index >= 148 && index < 156 ? 0x20 : byte),
    0,
  );
}

/**
 * The records of a PAX header's data, by key. Each record's length counts bytes, so the records
 * are cut on the bytes before any is read as UTF-8.
 */
export function paxFields(data: Uint8Array): ReadonlyMap<string, string> {
  const bytes = Buffer.from(data);
  const fields = new Map<string, string>();
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(0x20, at);
    const length = Number.parseInt(bytes.subarray(at, space).toString("ascii"), 10);
    const end = at + length;
    if (space < 0 || !Number.isInteger(length) || end <= space || end > bytes.length) {
      throw broken("a PAX record is malformed");
    }
    const record = bytes.subarray(space + 1, end - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals < 0 || bytes[end - 1] !== 0x0a) {
      throw broken("a PAX record is malformed");
    }
    fields.set(record.slice(0, equals), record.slice(equals + 1));
    at = end;
  }
  return fields;
}

async function* contentOf(reader: ByteReader, bytes: number): AsyncGenerator<Uint8Array> {
  let left = bytes;
  while (left > 0) {
    const length = Math.min(left, pieceBytes);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each piece follows the one before
    yield await reader.take(length);
    left -= length;
  }
}

async function skipPadding(reader: ByteReader, bytes: number): Promise<void> {
  await reader.take((blockBytes - (bytes % blockBytes)) % blockBytes);
}

interface Pending {
  readonly path?: string;
  readonly size?: number;
}

async function readPax(reader: ByteReader, size: number): Promise<Pending> {
  const data = await reader.take(size);
  await skipPadding(reader, size);
  const fields = paxFields(data);
  const path = fields.get("path");
  const sizeText = fields.get("size");
  if (sizeText !== undefined && !/^\d+$/u.test(sizeText)) {
    throw broken("a PAX size is not a number");
  }
  return {
    ...(path === undefined ? {} : { path }),
    ...(sizeText === undefined ? {} : { size: Number(sizeText) }),
  };
}

async function readEnd(reader: ByteReader): Promise<void> {
  const second = await reader.take(blockBytes);
  if (second.some((byte) => byte !== 0) || !(await reader.isDone())) {
    throw broken("bytes follow the end of the archive");
  }
}

/**
 * Reads a tar archive as {@link writeTar} writes it, handing each regular file to `onFile` in
 * order. Each header's checksum is checked; a PAX record sets the next file's path and size. Any
 * other kind of entry, a broken header, a short archive or bytes after its end throw
 * `backup.archive_damaged`.
 */
export async function readTar(
  pieces: AsyncIterable<Uint8Array>,
  onFile: TarFileHandler,
): Promise<void> {
  const reader = createByteReader(pieces);
  try {
    await readEntries(reader, onFile);
  } finally {
    await reader.close();
  }
}

async function readEntries(reader: ByteReader, onFile: TarFileHandler): Promise<void> {
  let pending: Pending = {};
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each block follows the one before
    const block = await reader.take(blockBytes);
    if (block.every((byte) => byte === 0)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the end is read once
      await readEnd(reader);
      return;
    }
    if (checksumOf(block) !== numberOf(block, 148, 8)) {
      throw broken("a header's checksum does not match");
    }
    const type = String.fromCodePoint(block[156] ?? 0);
    const size = numberOf(block, 124, 12);
    if (type === "x") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the record belongs to the next header
      pending = await readPax(reader, size);
      continue;
    }
    if (type !== "0" && type !== "\0") {
      throw broken(`it holds an entry of type ${JSON.stringify(type)}, not a file`);
    }
    const entry = { path: pending.path ?? textOf(block, 0, 100), bytes: pending.size ?? size };
    pending = {};
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, in archive order
    await onFile(entry, contentOf(reader, entry.bytes));
    // oxlint-disable-next-line eslint/no-await-in-loop -- the padding follows the file
    await skipPadding(reader, entry.bytes);
  }
}
