import { ok } from "@binference/core";
import { createPrivyApi, findOwnedWallets } from "@binference/custody-privy";
import type { BackupManifest } from "../backups/backup-manifest.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import type { AttachApp } from "./attach-app.js";

/** What a restored backup is checked by: its owner key, its manifest, and the signer it names. */
export interface RestoredCheck {
  readonly ownerKeyPublic: string;
  readonly manifest: BackupManifest;
  /**
   * The key quorum of the agent key the backup's install signs with; when given, Privy must list
   * it as each wallet's signer now, so the restore moves no signer.
   */
  readonly signer?: string;
}

/**
 * Checks a restored backup against Privy before any wallet moves (keys spec, section 7.4, step
 * 5): the live wallets its manifest names must be exactly the wallets Privy reports the owner key
 * owns in the app, read as a rebuild reads them. A wallet made after the backup, or one gone
 * since, is a mismatch, and the restore stops. A backup whose signer the wallets no longer list
 * stops it too.
 */
export async function checkRestoredWallets(
  context: InitContext,
  app: AttachApp,
  restored: RestoredCheck,
): Promise<InitStep<void>> {
  const { host, signal } = context;
  const api = createPrivyApi({ http: host.http, clock: host.clock, ...app });
  const owned = await findOwnedWallets(api, { ownerKey: restored.ownerKeyPublic }, { signal });
  const onPrivy = new Set<string>(owned.map((found) => found.wallet.id));
  const listed = new Set(restored.manifest.privy.wallets);
  const isSame =
    restored.manifest.privy.appId === app.appId &&
    onPrivy.size === listed.size &&
    [...listed].every((wallet) => onPrivy.has(wallet));
  if (!isSame) {
    return refused("init.restore_wallets_differ", "refused.restoreWalletsDiffer");
  }
  const { signer } = restored;
  const isSigned =
    signer === undefined ||
    owned.every(({ wallet }) => wallet.signers.some((held) => held.signerId === signer));
  return isSigned
    ? ok(undefined)
    : refused("backup.restore_other_signer", "refused.restoreOtherSigner");
}
