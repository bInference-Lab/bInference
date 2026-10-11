import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createSecret, ok, type Secret } from "@binference/core";
import { fileSize, readFilePieces, removePath } from "@binference/platform";
import { parseOwnerKeyCode } from "@binference/signer";
import { knownSchemaVersions } from "@binference/store";
import type { BackupManifest } from "../backups/backup-manifest.schema.js";
import { type OpenedBackup, openBackup } from "../backups/open-backup.js";
import { ownerKeyRecipient } from "../backups/owner-key-recipient.js";
import { type StateSwap, swapInRestored } from "../backups/state-swap.js";
import { unpackBackup } from "../backups/unpack-backup.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";

/** A backup restored in place, before attach goes on. */
export interface Restored {
  /** The owner key code that opened it, for attach to sign with; it is kept nowhere else. */
  readonly ownerKey: Secret;
  readonly manifest: BackupManifest;
  readonly swap: StateSwap;
  /** The folder the backup was unpacked into, empty once the files moved in place. */
  readonly unpacked: string;
}

// How many owner key codes a person may type before the restore stops.
const maxTries = 3;

async function askOwnerKey(
  context: InitContext,
  file: string,
  tries: number,
): Promise<InitStep<{ readonly code: Secret; readonly opened: OpenedBackup }>> {
  const typed = await context.prompter.ask({
    id: "ownerKey",
    message: context.words("restore.ownerKey"),
    isSecret: true,
  });
  const code = createSecret(typed.trim());
  const pair = parseOwnerKeyCode(code);
  const pieces = readFilePieces(file, { signal: context.signal });
  const opened = pair.ok
    ? await openBackup(pieces, ownerKeyRecipient(pair.value.privateKey))
    : undefined;
  if (opened?.ok === true) {
    return ok({ code, opened: opened.value });
  }
  if (opened?.ok === false && opened.error !== "wrong_owner_key") {
    return opened.error === "newer_version"
      ? refused("init.restore_newer_format", "refused.restoreNewerFormat", { file })
      : refused("init.restore_not_backup", "refused.restoreNotBackup", { file });
  }
  if (tries >= maxTries) {
    return refused("init.restore_owner_key", "refused.restoreOwnerKey");
  }
  context.prompter.say(context.words("restore.ownerKeyWrong"));
  return askOwnerKey(context, file, tries + 1);
}

function isNewer(manifest: BackupManifest): boolean {
  const known = knownSchemaVersions();
  const { engine, agent, config } = manifest.schemaVersions;
  return engine > known.engine || (agent ?? 0) > known.agent || config > currentConfigVersion;
}

/**
 * The restore step of `binference init --attach --restore <file>` (keys spec, section 7.4), run
 * under the engine lock: it asks a person for the owner key, hidden, up to 3 times, and opens the
 * backup's data key with it before any chunk is read; decrypts the backup into a fresh folder in
 * the state folder, checking every chunk and every file; refuses a backup of a newer schema than
 * this binference knows; then moves the state it replaces aside, kept 7 days, and puts the
 * restored files in place. Nothing in the state folder changes before every check passed.
 */
export async function restoreBackup(
  context: InitContext,
  file: string,
): Promise<InitStep<Restored>> {
  const { platform, signal, host } = context;
  if (!(await fileSize(file, signal)).ok) {
    return refused("init.restore_not_found", "refused.restoreNotFound", { file });
  }
  if (!context.isInteractive) {
    return refused("init.owner_key_needs_terminal", "refused.attachOwnerKeyTerminal");
  }
  const asked = await askOwnerKey(context, file, 1);
  if (!asked.ok) {
    return asked;
  }
  const unpacked = join(platform.stateFolder.root, `.restoring-${randomBytes(8).toString("hex")}`);
  const writing = { permissions: platform.permissions, signal };
  const manifest = await unpackBackup(asked.value.opened, unpacked, writing);
  if (!manifest.ok || isNewer(manifest.value)) {
    await removePath(unpacked, signal);
    return manifest.ok
      ? refused("init.restore_newer_schema", "refused.restoreNewerSchema")
      : refused("init.restore_damaged", "refused.restoreDamaged", { file });
  }
  const swap = await swapInRestored(platform.stateFolder, unpacked, {
    ...writing,
    atMs: host.clock.now(),
  });
  return ok({ ownerKey: asked.value.code, manifest: manifest.value, swap, unpacked });
}
