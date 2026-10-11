import { createHash, timingSafeEqual } from "node:crypto";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import { isArchivePath, manifestPath } from "./archive-path.js";
import {
  type BackupManifest,
  backupManifestSchema,
  type ManifestFile,
} from "./backup-manifest.schema.js";
import { readTar, type TarEntry } from "./tar-reader.js";

/** Keeps one checked file's bytes as they are read, such as by writing them into a folder. */
export type KeepFile = (entry: TarEntry, content: AsyncIterable<Uint8Array>) => Promise<void>;

// The manifest is a few kilobytes even for thousands of files; past this it is no manifest.
const maxManifestBytes = 16 * 1_048_576;

function mismatch(why: string): BinferenceError {
  return new BinferenceError({
    code: "backup.archive_damaged",
    message: `The backup's archive does not match its manifest: ${why}.`,
  });
}

/** A file's bytes as they pass, hashed and counted. */
interface Tapped {
  readonly content: AsyncIterable<Uint8Array>;
  readonly digest: () => string;
  readonly bytes: () => number;
}

function tapped(content: AsyncIterable<Uint8Array>): Tapped {
  const hash = createHash("sha256");
  let bytes = 0;
  async function* pass(): AsyncGenerator<Uint8Array> {
    for await (const piece of content) {
      hash.update(piece);
      bytes += piece.length;
      yield piece;
    }
  }
  return { content: pass(), digest: () => hash.digest("hex"), bytes: () => bytes };
}

async function drain(content: AsyncIterable<Uint8Array>): Promise<number> {
  let bytes = 0;
  for await (const piece of content) {
    bytes += piece.length;
  }
  return bytes;
}

async function manifestOf(
  entry: TarEntry,
  content: AsyncIterable<Uint8Array>,
): Promise<BackupManifest> {
  if (entry.bytes > maxManifestBytes) {
    throw mismatch("the manifest is too large");
  }
  const pieces: Uint8Array[] = [];
  for await (const piece of content) {
    pieces.push(piece);
  }
  try {
    const json = jsonValueSchema.parse(JSON.parse(Buffer.concat(pieces).toString("utf8")));
    return backupManifestSchema.parse(json);
  } catch (error) {
    throw new BinferenceError({
      code: "backup.archive_damaged",
      message: "The backup's manifest cannot be read.",
      cause: error,
    });
  }
}

function sameDigest(left: string, right: string): boolean {
  const [a, b] = [Buffer.from(left, "hex"), Buffer.from(right, "hex")];
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertMatches(read: readonly ManifestFile[], manifest: BackupManifest): void {
  if (read.length !== manifest.files.length) {
    throw mismatch("it lists another number of files");
  }
  read.forEach((file, index) => {
    const listed = manifest.files[index];
    const isSame =
      listed !== undefined &&
      listed.path === file.path &&
      listed.bytes === file.bytes &&
      sameDigest(listed.sha256, file.sha256);
    if (!isSame) {
      throw mismatch(`${file.path} differs from what it lists`);
    }
  });
}

/**
 * Reads a backup's decrypted archive and checks it against its manifest, which comes last: each
 * file's path is one a backup holds, comes once, and has the size and SHA-256 the manifest lists,
 * and the manifest lists no other file. `keep` takes each file's bytes as they are read; without
 * it they are only hashed. Answers the manifest; anything else throws `backup.archive_damaged`.
 * What `keep` took counts as checked only once this returns.
 */
export async function checkArchive(
  plaintext: AsyncIterable<Uint8Array>,
  keep: KeepFile = async (_entry, content) => {
    await drain(content);
  },
): Promise<BackupManifest> {
  const read: ManifestFile[] = [];
  const seen = new Set<string>();
  let manifest: BackupManifest | undefined;
  await readTar(plaintext, async (entry, content) => {
    if (manifest !== undefined || !isArchivePath(entry.path) || seen.has(entry.path)) {
      throw mismatch(`${entry.path} cannot stand there`);
    }
    seen.add(entry.path);
    if (entry.path === manifestPath) {
      manifest = await manifestOf(entry, content);
      return;
    }
    const tap = tapped(content);
    await keep(entry, tap.content);
    if (tap.bytes() !== entry.bytes) {
      throw new BinferenceError({
        code: "backup.file_unread",
        message: `${entry.path} was not read to its end; whatever keeps a file reads all of it.`,
      });
    }
    read.push({ path: entry.path, bytes: entry.bytes, sha256: tap.digest() });
  });
  if (manifest === undefined) {
    throw mismatch("it has no manifest");
  }
  assertMatches(read, manifest);
  return manifest;
}
