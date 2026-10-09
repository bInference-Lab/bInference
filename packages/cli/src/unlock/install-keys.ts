import { err, type Result } from "@binference/core";
import type { UnlockCall } from "./engine-lock.js";
import {
  type LockReason,
  type UnlockedKeys,
  type UnlockOptions,
  unlockKeys,
} from "./unlock-keys.js";

/** What an install's keys are opened from: the install's facts and the unlock mode's options. */
export interface InstallKeysOptions {
  /** The agent key's public half that the install's wallets name as their signer. */
  readonly agentKeyPublic: string;
  /** The install's id, which the `manual` mode's sealed file is bound to. */
  readonly installId: string;
  readonly unlock: Omit<UnlockOptions, "installId" | "passphrase">;
}

/**
 * Opens an install's agent key and Privy app secret through the unlock mode, and checks that the
 * key is the one its wallets name as their signer: another key is `agent_key_invalid`, since
 * Privy would refuse everything it signs.
 */
export async function openInstallKeys(
  options: InstallKeysOptions,
  call: UnlockCall,
): Promise<Result<UnlockedKeys, LockReason>> {
  const { signal, passphrase } = call;
  const opened = await unlockKeys(
    {
      ...options.unlock,
      installId: options.installId,
      ...(passphrase === undefined ? {} : { passphrase }),
    },
    { signal },
  );
  return !opened.ok || opened.value.agentPublicKey === options.agentKeyPublic
    ? opened
    : err("agent_key_invalid");
}
