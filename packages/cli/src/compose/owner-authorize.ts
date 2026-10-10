import { err, ok, type Result, type Secret } from "@binference/core";
import type { OwnerAuthorize } from "@binference/custody-privy";
import { parseOwnerKeyCode, signAuthorization } from "@binference/signer";

/** Where custody's owner-key adapters read the public half of the install's owner key. */
export interface OwnerKeyHolder {
  /** The owner key's public half the install's custody holds; undefined before `init`. */
  readonly ownerKeyPublic: (signal: AbortSignal) => Promise<string | undefined>;
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
  return ok(async (request) => ok(signAuthorization(privateKey, request)));
}
