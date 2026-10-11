import { removePath } from "@binference/platform";
import { parseOwnerKeyCode } from "@binference/signer";
import { restoreBackup } from "../attach/restore-backup.js";
import { checkRestoredWallets } from "../attach/restored-wallets.js";
import type { AttachAfterRestore } from "../attach/run-attach.js";
import { type InitContext, type InitRefusal, refused } from "../init/init-context.js";
import type { ExitCode } from "../program/cli-output.js";

/** What a restore hands on to: the attach that follows it, and how init refuses. */
export interface RestoreThen {
  readonly attach: (restore: AttachAfterRestore) => Promise<ExitCode>;
  readonly refuse: (refusal: InitRefusal) => ExitCode;
}

/**
 * `binference init --attach --restore <file>` (keys spec, section 7.4; decision 0142): restores
 * the backup in place, then attaches this machine to the install it holds, signing with the owner
 * key that opened the backup. Attach checks the backup's wallets against Privy before it makes a
 * key or moves a wallet. When attach stops before a wallet moved, the restore is undone and the state folder is as
 * it was; once wallets move, the restored state stays, and the same attach again goes on.
 */
export async function restoreAndAttach(
  context: InitContext,
  file: string,
  then: RestoreThen,
): Promise<ExitCode> {
  const restored = await restoreBackup(context, file);
  if (!restored.ok) {
    return then.refuse(restored.refusal);
  }
  const { swap, manifest, ownerKey, unpacked } = restored.value;
  const pair = parseOwnerKeyCode(ownerKey);
  const state = { isMoving: false };
  const restore: AttachAfterRestore = {
    ownerKey,
    checkWallets: async (app) =>
      pair.ok
        ? checkRestoredWallets(context, app, { ownerKeyPublic: pair.value.publicKey, manifest })
        : refused("wallet.bad_owner_key", "refused.attachOwnerKey"),
    onMove: () => {
      state.isMoving = true;
    },
  };
  const when = context.dateTime(manifest.createdAt);
  context.prompter.say(
    swap.aside === undefined
      ? context.words("restore.placed", { when })
      : context.words("restore.placedAside", { when, folder: swap.aside }),
  );
  try {
    const code = await then.attach(restore);
    if (code !== 0 && !state.isMoving) {
      await swap.undo();
      context.prompter.say(context.words("restore.undone"));
    }
    return code;
  } finally {
    await removePath(unpacked, context.signal);
  }
}
