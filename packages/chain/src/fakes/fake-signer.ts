import { err, type Id, ok } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { Signer } from "../ports.js";
import { signFake } from "./fake-signing-scheme.js";

/**
 * A signer for tests, shaped like a signer service: it holds each wallet's account, signs as the
 * fake family expects, and refuses a wallet once its owner removed the signer from it.
 */
export interface FakeSigner extends Signer {
  /** Removes this signer from a wallet, as its owner may at any time; later signing is refused. */
  removeFrom(wallet: Id<"wal">): void;
}

/** Creates a {@link FakeSigner} that holds the given wallets, each with its one account. */
export function createFakeSigner(wallets: ReadonlyMap<Id<"wal">, AccountRef>): FakeSigner {
  const removed = new Set<Id<"wal">>();
  return {
    async account(wallet, chain, options) {
      options.signal.throwIfAborted();
      const account = wallets.get(wallet);
      const onChain = account !== undefined && accountRefParts(account).chain === chain;
      return await Promise.resolve(onChain ? ok(account) : err("unknown_wallet"));
    },
    async signTransaction(request, options) {
      options.signal.throwIfAborted();
      const account = wallets.get(request.wallet);
      if (account === undefined) {
        return err("unknown_wallet");
      }
      const refused = removed.has(request.wallet) || request.tx.from !== account;
      return await Promise.resolve(
        refused ? err("refused") : ok(signFake(request.tx, accountRefParts(account).address)),
      );
    },
    removeFrom: (wallet) => {
      removed.add(wallet);
    },
  };
}
