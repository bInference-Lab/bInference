import { err, ok, type Result } from "@binference/core";
import { hpkeOpen, type HpkeRecipientKey } from "../hpke/hpke-seal.js";
import type { BackupHeader } from "./backup-header.schema.js";
import { backupKeySuite } from "./backup-suite.js";
import { type ChunkFrame, dataKeyBytes } from "./chunk-cipher.js";
import { headerDigest, type HeaderProblem, parseHeader, splitHeader } from "./header-line.js";

/** A backup whose data key the owner key opened; its body is not read yet. */
export interface OpenedBackup {
  readonly header: BackupHeader;
  /** The data key; the caller zeroes it once the body is read. */
  readonly dataKey: Uint8Array;
  readonly frame: ChunkFrame;
  readonly body: AsyncIterable<Uint8Array>;
  /** Closes the file when the body is not read to its end. */
  readonly close: () => Promise<void>;
}

/**
 * The keys that open a backup: the owner key for a version 2 file, the sealing key it derives for
 * a version 3 one. A file whose key is not given opens as `wrong_owner_key`.
 */
export interface BackupKeys {
  readonly ownerKey?: HpkeRecipientKey;
  readonly sealingKey?: HpkeRecipientKey;
}

/** Why a backup did not open: no backup, a later format, or another owner key's backup. */
export type OpenProblem = HeaderProblem | "wrong_owner_key";

const encapsulatedKeyBytes = 65;

/**
 * Opens a backup file's data key with the owner key (keys spec, section 7.4, step 1): it reads
 * the header line, then opens the wrapped key with HPKE, with the owner key for a version 2 file
 * and the sealing key for a version 3 one. A wrong owner key fails here, as `wrong_owner_key`,
 * before any chunk of the body is read or opened.
 */
export async function openBackup(
  pieces: AsyncIterable<Uint8Array>,
  keys: BackupKeys,
): Promise<Result<OpenedBackup, OpenProblem>> {
  const split = await splitHeader(pieces);
  if (!split.ok) {
    return split;
  }
  const { line, body, close } = split.value;
  const header = parseHeader(line);
  if (!header.ok) {
    await close();
    return header;
  }
  const wrapped = Buffer.from(header.value.wrappedKey, "base64");
  const { version } = header.value;
  const key = version === 2 ? keys.ownerKey : keys.sealingKey;
  const sealed = {
    encapsulatedKey: wrapped.subarray(0, encapsulatedKeyBytes),
    ciphertext: wrapped.subarray(encapsulatedKeyBytes),
  };
  const dataKey =
    key === undefined ? undefined : await hpkeOpen(key, sealed, backupKeySuite(version));
  if (dataKey?.length !== dataKeyBytes) {
    dataKey?.fill(0);
    await close();
    return err("wrong_owner_key");
  }
  const noncePrefix = Buffer.from(header.value.noncePrefix, "base64");
  const frame = { noncePrefix, headerDigest: headerDigest(line) };
  return ok({ header: header.value, dataKey, frame, body, close });
}
