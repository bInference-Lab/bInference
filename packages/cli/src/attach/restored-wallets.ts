import { ok } from "@binference/core";
import { createPrivyApi, findOwnedWallets } from "@binference/custody-privy";
import type { BackupManifest } from "../backups/backup-manifest.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import type { AttachApp } from "./attach-app.js";

/**
 * Checks a restored backup against Privy before any wallet moves (keys spec, section 7.4, step
 * 5): the live wallets its manifest names must be exactly the wallets Privy reports the owner key
 * owns in the app, read as a rebuild reads them. A wallet made after the backup, or one gone
 * since, is a mismatch, and the restore stops.
 */
export async function checkRestoredWallets(
  context: InitContext,
  app: AttachApp,
  restored: { readonly ownerKeyPublic: string; readonly manifest: BackupManifest },
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
  return isSame
    ? ok(undefined)
    : refused("init.restore_wallets_differ", "refused.restoreWalletsDiffer");
}
