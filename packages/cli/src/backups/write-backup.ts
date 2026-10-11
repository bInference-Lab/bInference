import { createHash, randomBytes } from "node:crypto";
import { err, ok, type Result } from "@binference/core";
import type { BackupKind } from "@binference/engine/backups";
import {
  fileSize,
  type FilePermissions,
  readFilePieces,
  writePrivateStream,
} from "@binference/platform";
import { hpkeSeal } from "../hpke/hpke-seal.js";
import { manifestPath } from "./archive-path.js";
import type { BackupHeader } from "./backup-header.schema.js";
import type { BackupManifest, ManifestFile } from "./backup-manifest.schema.js";
import { backupKeySuite } from "./backup-suite.js";
import { type ChunkFrame, dataKeyBytes, noncePrefixBytes } from "./chunk-cipher.js";
import { sealBody } from "./chunk-stream.js";
import { headerDigest, headerLine } from "./header-line.js";
import { type TarFile, writeTar } from "./tar-writer.js";

/** One file a backup holds: its path in the archive and where it is on disk. */
export interface ArchivedFile {
  readonly path: string;
  readonly from: string;
}

/** What one backup holds and says about itself. */
export interface BackupPlan {
  /** The `.bnfbak` file to write; its folder must exist. */
  readonly target: string;
  readonly installId: BackupHeader["installId"];
  readonly createdAt: number;
  readonly kind: BackupKind;
  readonly binferenceVersion: string;
  /** The owner key's public half, DER SubjectPublicKeyInfo in base64: the one key that opens it. */
  readonly ownerKeyPublic: string;
  /** The files, in archive order; one gone by the time it is read is left out. */
  readonly files: readonly ArchivedFile[];
  readonly schemaVersions: BackupManifest["schemaVersions"];
  readonly privy: BackupManifest["privy"];
}

/**
 * A backup as it was written. The data key stays with the caller only to check the file at once
 * (keys spec, section 7.3); the caller zeroes it then.
 */
export interface WrittenBackup {
  readonly bytes: number;
  readonly line: Uint8Array;
  readonly dataKey: Buffer;
  readonly frame: ChunkFrame;
  readonly manifest: BackupManifest;
}

/** Where a backup is written, and with what access. */
export interface BackupWriting {
  readonly permissions: FilePermissions;
  readonly signal: AbortSignal;
}

async function* hashing(
  from: string,
  digest: (sha256: string) => void,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const hash = createHash("sha256");
  for await (const piece of readFilePieces(from, { signal })) {
    hash.update(piece);
    yield piece;
  }
  digest(hash.digest("hex"));
}

async function* archived(
  plan: BackupPlan,
  listed: ManifestFile[],
  signal: AbortSignal,
): AsyncGenerator<TarFile> {
  for (const file of plan.files) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, in archive order
    const size = await fileSize(file.from, signal);
    if (!size.ok) {
      continue;
    }
    const bytes = size.value;
    const content = hashing(
      file.from,
      (sha256) => listed.push({ path: file.path, bytes, sha256 }),
      signal,
    );
    yield { path: file.path, bytes, content };
  }
  const text = Buffer.from(JSON.stringify(manifestOf(plan, listed)), "utf8");
  yield { path: manifestPath, bytes: text.length, content: once(text) };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield await Promise.resolve(bytes);
}

function manifestOf(plan: BackupPlan, files: readonly ManifestFile[]): BackupManifest {
  return {
    format: "binference-backup-manifest",
    version: 1,
    binferenceVersion: plan.binferenceVersion,
    installId: plan.installId,
    createdAt: plan.createdAt,
    schemaVersions: plan.schemaVersions,
    privy: plan.privy,
    files,
  };
}

/**
 * Writes a backup file (keys spec, section 7.2): a fresh 32-byte data key and 8-byte nonce
 * prefix from the OS CSPRNG, the data key sealed to the owner key's public half with HPKE, the
 * header line, then the tar archive of the files and their manifest, encrypted in 64 KiB chunks.
 * The file is owner-only and appears whole or not at all. An owner key that is no P-256 public key
 * is `bad_owner_key`, and nothing is written. The data key comes back for the check that follows;
 * the caller zeroes it.
 */
export async function writeBackup(
  plan: BackupPlan,
  writing: BackupWriting,
): Promise<Result<WrittenBackup, "bad_owner_key">> {
  const dataKey = randomBytes(dataKeyBytes);
  const noncePrefix = randomBytes(noncePrefixBytes);
  const wrapped = await hpkeSeal(plan.ownerKeyPublic, dataKey, backupKeySuite);
  if (wrapped === undefined) {
    dataKey.fill(0);
    return err("bad_owner_key");
  }
  const header: BackupHeader = {
    format: "binference-backup",
    version: 2,
    installId: plan.installId,
    createdAt: plan.createdAt,
    kind: plan.kind,
    binferenceVersion: plan.binferenceVersion,
    cipher: "aes-256-gcm-stream",
    chunkBytes: 65_536,
    noncePrefix: noncePrefix.toString("base64"),
    wrappedKey: Buffer.concat([wrapped.encapsulatedKey, wrapped.ciphertext]).toString("base64"),
  };
  const line = headerLine(header);
  const frame = { noncePrefix, headerDigest: headerDigest(line) };
  const listed: ManifestFile[] = [];
  const archive = writeTar(archived(plan, listed, writing.signal), { mtimeMs: plan.createdAt });
  try {
    await writePrivateStream(plan.target, fileOf(line, sealBody(archive, dataKey, frame)), writing);
  } catch (error) {
    dataKey.fill(0);
    throw error;
  }
  const size = await fileSize(plan.target, writing.signal);
  const bytes = size.ok ? size.value : 0;
  return ok({ bytes, line, dataKey, frame, manifest: manifestOf(plan, listed) });
}

async function* fileOf(
  line: Uint8Array,
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  yield Buffer.concat([line, Buffer.of(0x0a)]);
  yield* body;
}
