import type { KeyObject } from "node:crypto";
import { BinferenceError, err, ok, type Result, type Secret } from "@binference/core";
import type { OwnerAuthorize } from "@binference/custody-privy";
import type { InstallStore } from "@binference/engine/install";
import { parseOwnerKeyCode, signAuthorization } from "@binference/signer";

/** Where custody's owner-key adapters read the public half of the install's owner key. */
export interface OwnerKeyHolder {
  /** The owner key's public half the install's custody holds; undefined before `init`. */
  readonly ownerKeyPublic: (signal: AbortSignal) => Promise<string | undefined>;
  /**
   * Called with the owner key once a code proved to be it, before it signs anything, such as to
   * keep the sealing key it derives (keys spec, section 7.2). A fault here never stops the
   * request the key was entered for.
   */
  readonly onOwnerKey?: (ownerKey: KeyObject, signal: AbortSignal) => Promise<void>;
}

/**
 * The owner key of an install: the public half its custody holds, read at each request, and the
 * hook that takes the key once a request proved it.
 */
export function installOwnerKey(
  install: Pick<InstallStore, "read">,
  onOwnerKey: NonNullable<OwnerKeyHolder["onOwnerKey"]>,
): Required<OwnerKeyHolder> {
  return {
    ownerKeyPublic: async (signal) => (await install.read({ signal })).custody?.ownerKeyPublic,
    onOwnerKey,
  };
}

// Hands the owner key to the holder's hook; a store fault there leaves the request to go on, and
// the hook runs again the next time the key is entered.
async function handOwnerKeyOn(
  holder: Pick<OwnerKeyHolder, "onOwnerKey">,
  ownerKey: KeyObject,
  signal: AbortSignal,
): Promise<void> {
  try {
    await holder.onOwnerKey?.(ownerKey, signal);
  } catch (error) {
    if (signal.aborted || !(error instanceof BinferenceError)) {
      throw error;
    }
  }
}

/**
 * Signs Privy requests as the owner key the code holds, when it is the key that owns the install;
 * `bad_owner_key` for any other code, or before the install holds one. The key serves the one
 * request it is read for and is kept nowhere.
 */
export async function ownerAuthorize(
  holder: OwnerKeyHolder,
  code: Secret,
  signal: AbortSignal,
): Promise<Result<OwnerAuthorize, "bad_owner_key">> {
  signal.throwIfAborted();
  const pair = parseOwnerKeyCode(code);
  const expected = await holder.ownerKeyPublic(signal);
  if (!pair.ok || expected === undefined || pair.value.publicKey !== expected) {
    return err("bad_owner_key");
  }
  const { privateKey } = pair.value;
  await handOwnerKeyOn(holder, privateKey, signal);
  return ok(async (request) => ok(signAuthorization(privateKey, request)));
}
