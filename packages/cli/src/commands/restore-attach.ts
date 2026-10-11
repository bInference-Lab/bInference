import { removePath } from "@binference/platform";
import { parseOwnerKeyCode } from "@binference/signer";
import { restoreBackup, swapRefusal } from "../attach/restore-backup.js";
import { checkRestoredWallets } from "../attach/restored-wallets.js";
import type { AttachAfterRestore } from "../attach/run-attach.js";
import type { StateSwap } from "../backups/state-swap.js";
import { type InitContext, type InitRefusal, refused } from "../init/init-context.js";
import type { ExitCode } from "../program/cli-output.js";

/** What a restore hands on to: the attach that follows it, and how init refuses. */
export interface RestoreThen {
  readonly attach: (restore: AttachAfterRestore) => Promise<ExitCode>;
  readonly refuse: (refusal: InitRefusal) => ExitCode;
}

// Undoes the swap of an attach that stopped before a wallet moved; a swap that cannot be undone in
// full is refused with the places of both states, whose staged files then stay.
async function undo(
  context: InitContext,
  swap: StateSwap,
  after: {
    readonly keepStaged: () => void;
    readonly code: ExitCode;
    readonly refuse: RestoreThen["refuse"];
  },
): Promise<ExitCode> {
  try {
    await swap.undo();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    after.keepStaged();
    return after.refuse(swapRefusal(error, context.platform.stateFolder.root).refusal);
  }
  context.prompter.say(context.words("restore.undone"));
  return after.code;
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
  const staged = { isKept: false };
  try {
    const code = await then.attach(restore);
    if (code !== 0 && !state.isMoving) {
      const keepStaged = (): void => {
        staged.isKept = true;
      };
      return await undo(context, swap, { keepStaged, code, refuse: then.refuse });
    }
    return code;
  } finally {
    if (!staged.isKept) {
      await removePath(unpacked, context.signal);
    }
  }
}
