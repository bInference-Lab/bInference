import { createHash } from "node:crypto";
import { err, type JsonValue, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type BackupHeader,
  backupFormatSchema,
  backupHeaderSchema,
} from "./backup-header.schema.js";

// A header line is about 400 bytes; a file whose first 4 KiB hold no line break is no backup.
const maxHeaderBytes = 4_096;
const newline = 0x0a;

/** A backup file split after its header line: the line's bytes and the body that follows. */
export interface SplitBackup {
  /** The header line without its line break: the bytes its SHA-256 covers. */
  readonly line: Uint8Array;
  readonly body: AsyncIterable<Uint8Array>;
  /** Closes the file when the body is not read to its end. */
  readonly close: () => Promise<void>;
}

/** Why a file's first line is no header this binference opens. */
export type HeaderProblem = "not_a_backup" | "newer_version";

/**
 * The header's line in the spec's key order, without the line break. The writer puts a line break
 * after it; the SHA-256 that every chunk's associated data holds covers these bytes alone.
 */
export function headerLine(header: BackupHeader): Uint8Array {
  const ordered: BackupHeader = {
    format: header.format,
    version: header.version,
    installId: header.installId,
    createdAt: header.createdAt,
    kind: header.kind,
    binferenceVersion: header.binferenceVersion,
    cipher: header.cipher,
    chunkBytes: header.chunkBytes,
    noncePrefix: header.noncePrefix,
    wrappedKey: header.wrappedKey,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/** The SHA-256 of a header line's bytes. */
export function headerDigest(line: Uint8Array): Buffer {
  return createHash("sha256").update(line).digest();
}

function jsonOf(line: Uint8Array): JsonValue | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parses a header line: `newer_version` for a backup of a later format version, `not_a_backup`
 * for anything else that is not a version 2 or 3 header.
 */
export function parseHeader(line: Uint8Array): Result<BackupHeader, HeaderProblem> {
  const json = jsonOf(line);
  if (json === undefined) {
    return err("not_a_backup");
  }
  const parsed = backupHeaderSchema.safeParse(json);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const format = backupFormatSchema.safeParse(json);
  return format.success && format.data.version > 3 ? err("newer_version") : err("not_a_backup");
}

async function* restOf(
  first: Uint8Array,
  pieces: AsyncIterator<Uint8Array>,
): AsyncGenerator<Uint8Array, void, undefined> {
  try {
    if (first.length > 0) {
      yield first;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- each piece follows the one before
    for (let next = await pieces.next(); next.done !== true; next = await pieces.next()) {
      yield next.value;
    }
  } finally {
    await pieces.return?.();
  }
}

/**
 * Reads a backup file's pieces up to the first line break, and no further than the piece that
 * holds it: the header line, and the body as the pieces after it. A file with no line break in
 * its first 4 KiB is `not_a_backup`.
 */
export async function splitHeader(
  pieces: AsyncIterable<Uint8Array>,
): Promise<Result<SplitBackup, "not_a_backup">> {
  const reader = pieces[Symbol.asyncIterator]();
  let seen = Buffer.alloc(0);
  // oxlint-disable-next-line eslint/no-await-in-loop -- the body goes on from the same reader
  for (let next = await reader.next(); next.done !== true; next = await reader.next()) {
    seen = Buffer.concat([seen, next.value]);
    const end = seen.indexOf(newline);
    if (end >= 0 && end <= maxHeaderBytes) {
      const close = async (): Promise<void> => {
        await reader.return?.();
      };
      const body = restOf(seen.subarray(end + 1), reader);
      return ok({ line: seen.subarray(0, end), body, close });
    }
    if (seen.length > maxHeaderBytes) {
      break;
    }
  }
  await reader.return?.();
  return err("not_a_backup");
}
