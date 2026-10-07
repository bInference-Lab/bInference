import { accountRefParts, type ChainRegistry } from "@binference/chain";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { WalletFactsSource } from "../ports.js";
import type { PaperPortfolio } from "./paper-portfolio.js";

/** What paper balances replace a source's native balance with. */
export interface PaperWalletFactsOptions {
  readonly portfolio: PaperPortfolio;
  readonly chains: ChainRegistry;
}

/**
 * The wallet facts the money path reads, with a paper intent's native balance taken from the
 * paper portfolio: what the wallet's paper position of the chain's native coin holds, so a paper
 * trade works with an empty real wallet. Live intents read the source as it is. A chain the
 * registry does not hold has no native coin to hold on paper, so its paper balance is 0 and the
 * policy refuses the trade.
 */
export function withPaperBalances(
  source: WalletFactsSource,
  options: PaperWalletFactsOptions,
): WalletFactsSource {
  return {
    wallets: async (agent, call) => source.wallets(agent, call),
    async facts(query, call) {
      const facts = await source.facts(query, call);
      if (!query.isPaper) {
        return facts;
      }
      const chain = options.chains.get(accountRefParts(query.account).chain);
      const nativeBalanceBase = chain.ok
        ? await options.portfolio.balance(query.wallet, nativeAssetOf(chain.value), call)
        : 0n;
      return { ...facts, nativeBalanceBase };
    },
  };
}
