import type { Id } from "@binference/core";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { WalletFactsSource } from "../ports.js";

/**
 * Creates a wallet facts source for tests that answers from fixed tables and never touches a
 * chain: each agent's wallets in order, and the same facts for every wallet in either mode.
 */
export function createFakeWalletFacts(
  wallets: ReadonlyMap<Id<"agt">, readonly Id<"wal">[]>,
  facts: WalletFacts,
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
  };
}
