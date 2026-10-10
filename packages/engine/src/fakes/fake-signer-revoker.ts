import { err, ok, type Result } from "@binference/core";
import type { SignerRevoker } from "../install/ports.js";
import type { RevokeRefusal } from "../install/signer-revocation.js";
import { fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { memoryCall } from "./memory-call.js";

/** A {@link SignerRevoker} in memory, and each wallet's signers it holds. */
export interface FakeSignerRevoker extends SignerRevoker {
  /** A wallet's signers now; none for a wallet it does not hold. */
  signersOf(wallet: string): readonly string[];
}

/**
 * Creates a {@link SignerRevoker} in memory over each wallet's signers, owned by the fake owner key
 * the fake ceiling editor takes, refusing as Privy custody does.
 */
export function createFakeSignerRevoker(
  signers: ReadonlyMap<string, readonly string[]>,
): FakeSignerRevoker {
  const held = new Map(signers);
  const decide = (signer: string, wallets: readonly string[]): Result<void, RevokeRefusal> => {
    const lists = wallets.map((wallet) => held.get(wallet));
    if (lists.includes(undefined)) {
      return err("not_found");
    }
    const listing = lists.filter((list) => list?.includes(signer) === true);
    if (listing.length === 0) {
      return err("not_signer");
    }
    return listing.some((list) => list?.length === 1) ? err("last_signer") : ok(undefined);
  };
  return {
    revoke: async (request, call) =>
      memoryCall(call, (): Result<readonly string[], RevokeRefusal> => {
        if (request.ownerKey.reveal() !== fakeOwnerKeyCode) {
          return err("bad_owner_key");
        }
        const decided = decide(request.signer, request.wallets);
        if (!decided.ok) {
          return decided;
        }
        const left = request.wallets.filter((wallet) =>
          (held.get(wallet) ?? []).includes(request.signer),
        );
        left.forEach((wallet) => {
          held.set(
            wallet,
            (held.get(wallet) ?? []).filter((item) => item !== request.signer),
          );
        });
        return ok(left);
      }),
    signersOf: (wallet) => held.get(wallet) ?? [],
  };
}
