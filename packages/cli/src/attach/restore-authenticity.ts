import { createHash } from "node:crypto";
import type { BackupRecord } from "@binference/engine/backups";
import { readFilePieces } from "@binference/platform";
import type { BackupManifest } from "../backups/backup-manifest.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { backupDay, type ReplacedState } from "./restore-guards-step.js";

/** What a restore knows of the file it opened: its digests, and what its manifest says. */
export interface OpenedFile {
  readonly file: string;
  /** The SHA-256 of the header line the data key was opened from, in hex. */
  readonly headerSha256: string;
  readonly manifest: BackupManifest;
}

async function fileSha256(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const piece of readFilePieces(file, { signal })) {
    hash.update(piece);
  }
  return hash.digest("hex");
}

// Whether the install recorded writing this file: the header it opened from and the whole file.
function isRecorded(
  records: readonly BackupRecord[],
  digests: { readonly header: string; readonly file: string },
): boolean {
  return records.some(
    (record) => record.headerSha256 === digests.header && record.fileSha256 === digests.file,
  );
}

/**
 * Proves a backup genuine before anything opens its databases (keys spec, section 7.4). Sealing to
 * the owner key's public half says nothing of who wrote a file, since the machine seals backups
 * without the owner key; so the install keeps the SHA-256 of each backup it writes and of its
 * header line. A file this install recorded goes on unasked. Any other file, and every file on a
 * machine whose state holds no record, is shown with its install id, its time and its wallets,
 * with a warning, and goes on only once the owner types the day it names.
 */
export async function authenticate(
  context: InitContext,
  opened: OpenedFile,
  replaced: ReplacedState,
): Promise<InitStep<void>> {
  const records = replaced.kind === "guards" ? replaced.guards.backups : undefined;
  const file = await fileSha256(opened.file, context.signal);
  if (records !== undefined && isRecorded(records, { header: opened.headerSha256, file })) {
    return { ok: true, value: undefined };
  }
  const { manifest } = opened;
  const when = context.dateTime(manifest.createdAt);
  const lines = [
    context.words(records === undefined ? "restore.unrecorded" : "restore.unknown"),
    context.words("restore.identity", { installId: manifest.installId, when }),
    ...manifest.privy.wallets.map((wallet) => context.words("restore.identityWallet", { wallet })),
  ];
  context.prompter.note(lines.join("\n"), context.words("restore.identityTitle"));
  const day = backupDay(manifest.createdAt);
  const typed = await context.prompter.ask({
    id: "restoreGenuine",
    message: context.words("restore.genuine", { day }),
  });
  return typed.trim() === day
    ? { ok: true, value: undefined }
    : refused("backup.restore_not_confirmed", "refused.restoreNotConfirmed", { day });
}
