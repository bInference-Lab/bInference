import { type AssetRef, assetRefParts, type ChainRegistry } from "@binference/chain";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { IntentStore, Simulator } from "../ports.js";
import type { PaperPortfolio } from "./paper-portfolio.js";

/** Where a paper intent's simulation reads its balances. */
export interface PaperSimulationOptions {
  readonly portfolio: PaperPortfolio;
  readonly intents: IntentStore;
  readonly chains: ChainRegistry;
}

// What a quote's steps draw on: the chain's native coin, for gas and value, and the asset it spends.
function drawnAssets(built: BuiltQuote, chains: ChainRegistry): readonly AssetRef[] {
  const spent = built.quote.amountIn.asset;
  const chain = chains.get(assetRefParts(spent).chain);
  return chain.ok ? [...new Set([nativeAssetOf(chain.value), spent])] : [spent];
}

/**
 * The simulate step with a paper intent's balances: for the run, the wallet holds what its paper
 * positions hold of the chain's native coin and of the asset the quote spends, so a paper trade
 * simulates from an empty real wallet as the policy judged it. A live intent, and one the store
 * does not hold, simulate on the chain's balances.
 */
export function withPaperSimulation(
  simulator: Simulator,
  options: PaperSimulationOptions,
): Simulator {
  return {
    async simulate(intent, built, call) {
      const { signal } = call;
      const record = await options.intents.get(intent, { signal });
      if (record?.isPaper !== true) {
        return simulator.simulate(intent, built, call);
      }
      const balances = await Promise.all(
        drawnAssets(built, options.chains).map(async (asset) => ({
          asset,
          base: await options.portfolio.balance(record.walletId, asset, { signal }),
        })),
      );
      return simulator.simulate(intent, built, { ...call, balances });
    },
  };
}
