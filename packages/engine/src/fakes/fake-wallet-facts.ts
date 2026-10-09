import { type AccountRef, accountRefParts, type Amount, assetRefParts } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { WalletFactsSource } from "../ports.js";

function heldOf(held: readonly Amount[], asset: Amount["asset"]): bigint {
  return held.filter((amount) => amount.asset === asset).reduce((sum, { base }) => sum + base, 0n);
}

/**
 * Creates a wallet facts source for tests that answers from fixed tables and never touches a
 * chain: each agent's wallets in order, the same facts for every wallet in either mode, and what
 * each account holds, nothing of an asset the table leaves out. An asset of another chain than
 * the account's is a fault, as on a chain.
 */
export function createFakeWalletFacts(
  wallets: ReadonlyMap<Id<"agt">, readonly Id<"wal">[]>,
  facts: WalletFacts,
  held: ReadonlyMap<AccountRef, readonly Amount[]> = new Map(),
): WalletFactsSource {
  return {
    async wallets(agent, options) {
      options.signal.throwIfAborted();
      return await Promise.resolve(wallets.get(agent) ?? []);
    },
    async facts(_query, options) {
      options.signal.throwIfAborted();
      return await Promise.resolve(facts);
    },
    async balances({ account, assets }, options) {
      options.signal.throwIfAborted();
      const { chain } = accountRefParts(account);
      if (assets.some((asset) => assetRefParts(asset).chain !== chain)) {
        throw new BinferenceError({
          code: "chain.bad_balances",
          message: "A balance of another chain's asset was asked for.",
        });
      }
      const amounts = held.get(account) ?? [];
      return await Promise.resolve(
        assets.map((asset) => ({ asset, base: heldOf(amounts, asset) })),
      );
    },
  };
}
