import { join } from "node:path";
import { ok } from "@binference/core";
import type { CustodyRecord } from "@binference/engine/install";
import { removePath } from "@binference/platform";
import { parseOwnerKeyCode } from "@binference/signer";
import { createSqliteInstallStore, engineWorker, openDatabase } from "@binference/store";
import { loadConfig } from "../config/load-config.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { systemDefaults } from "../program/system-defaults.js";
import { takeAttachApp } from "./attach-app.js";
import { type Unpacked, unpackRestore } from "./restore-backup.js";
import { checkRestoredWallets } from "./restored-wallets.js";

// The custody of the install a backup holds, from its `engine.sqlite` migrated to this build, as
// the start after the restore would migrate it.
async function restoredCustody(
  context: InitContext,
  unpacked: string,
): Promise<CustodyRecord | undefined> {
  const { host, signal } = context;
  const database = await openDatabase({
    file: join(unpacked, "engine.sqlite"),
    worker: engineWorker,
    execArgv: host.workerExecArgv ?? [],
    signal,
  });
  try {
    await database.migrate({ signal });
    return (await createSqliteInstallStore(database).read({ signal })).custody;
  } finally {
    await database.close();
  }
}

// Checks the backup against this install's config and against Privy: the same Privy app, the
// wallets Privy holds for the owner key, and the signer they list now.
async function checkOnPrivy(
  context: InitContext,
  file: string,
  unpacked: Unpacked,
): Promise<InitStep<void>> {
  const { host, platform, signal } = context;
  const custody = await restoredCustody(context, unpacked.unpacked);
  const pair = parseOwnerKeyCode(unpacked.ownerKey);
  if (custody === undefined || !pair.ok) {
    return refused("init.restore_damaged", "refused.restoreDamaged", { file });
  }
  const system = systemDefaults(host.env, platform);
  const configFile = platform.stateFolder.configFile;
  const config = await loadConfig({ file: configFile, env: host.env, sets: [], system, signal });
  if (!config.ok) {
    const folder = platform.stateFolder.root;
    return refused("backup.restore_config", "refused.restoreConfig", { folder });
  }
  if (config.config.custody.privy.appId !== custody.appId) {
    return refused("backup.restore_other_app", "refused.restoreOtherApp", {
      appId: custody.appId,
    });
  }
  const app = await takeAttachApp(context, config.config, custody);
  if (!app.ok) {
    return app;
  }
  return checkRestoredWallets(context, app.value, {
    ownerKeyPublic: pair.value.publicKey,
    manifest: unpacked.manifest,
    signer: custody.agentQuorumId,
  });
}

/**
 * Readies `binference backup restore <file>` while the engine still runs (decision 0152): opens
 * and checks the backup as `init --attach --restore` does, with the owner key typed at this
 * terminal, then checks it against this install. The backup must be of the Privy app
 * config.json5 names, hold the wallets Privy reports for the owner key, and name the key quorum
 * the wallets list as their signer now, so the restore moves no signer. A refusal changes nothing
 * and leaves no folder behind; the caller removes the unpacked folder once it is done with it.
 */
export async function prepareRestore(
  context: InitContext,
  file: string,
): Promise<InitStep<Unpacked>> {
  const needsTerminal = refused("backup.owner_key_needs_terminal", "refused.restoreTerminal");
  const unpacked = await unpackRestore(context, file, needsTerminal);
  if (!unpacked.ok) {
    return unpacked;
  }
  const outcome = { isKept: false };
  try {
    const checked = await checkOnPrivy(context, file, unpacked.value);
    outcome.isKept = checked.ok;
    return checked.ok ? ok(unpacked.value) : checked;
  } finally {
    if (!outcome.isKept) {
      await removePath(unpacked.value.unpacked, context.signal);
    }
  }
}
