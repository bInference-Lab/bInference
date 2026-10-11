import { type Clock, err, ok, type Result } from "@binference/core";
import { isPrivyId, type PrivyApi, type PrivyId, removeSigner } from "@binference/custody-privy";
import type { RevokeRefusal, SignerRevocation, SignerRevoker } from "@binference/engine/install";
import { ownerAuthorize, type OwnerKeyHolder } from "./owner-authorize.js";

/** What the Privy signer revoker reaches Privy with, and the owner key it takes. */
export interface PrivySignerRevokerOptions extends OwnerKeyHolder {
  readonly api: PrivyApi;
  readonly clock: Clock;
}

// Each change is signed and sent at once, so each expires 5 minutes after it is signed.
const expiryMs = 5 * 60_000;

async function revoke(
  options: PrivySignerRevokerOptions,
  request: SignerRevocation,
  signal: AbortSignal,
): Promise<Result<readonly string[], RevokeRefusal>> {
  const authorize = await ownerAuthorize(options, request.ownerKey, signal);
  if (!authorize.ok) {
    return authorize;
  }
  const wallets = request.wallets.filter(isPrivyId);
  if (wallets.length < request.wallets.length) {
    return err("not_found");
  }
  if (!isPrivyId(request.signer)) {
    return err("not_signer");
  }
  const target: { readonly wallets: readonly PrivyId[]; readonly signer: PrivyId } = {
    wallets,
    signer: request.signer,
  };
  const removed = await removeSigner(options.api, target, {
    authorize: authorize.value,
    expiry: () => options.clock.now() + expiryMs,
    signal,
  });
  if (removed.ok) {
    return ok(removed.value);
  }
  return err(removed.error === "refused" ? "bad_owner_key" : removed.error);
}

/**
 * The {@link SignerRevoker} on the owner's Privy app (spec 5, section 6): it reads the owner key
 * from its code, checks it is the key that owns the install before Privy hears of it, and removes
 * the signer from each wallet that lists it with changes the owner key signs, never a wallet's
 * last signer. The owner key serves the one request and is kept nowhere.
 */
export function createPrivySignerRevoker(options: PrivySignerRevokerOptions): SignerRevoker {
  return { revoke: async (request, { signal }) => revoke(options, request, signal) };
}
