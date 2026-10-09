import {
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  type SimulationOptions,
} from "@binference/chain";
import { BinferenceError, type Clock, type Id, ok, type Result } from "@binference/core";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { IntentStore, Simulator } from "../ports.js";
import type { SimulatedSteps } from "../simulation/simulated-steps.js";
import type { PaperPortfolio } from "./paper-portfolio.js";

/** Where a paper intent's simulation reads its balances. */
export interface PaperSimulationOptions {
  readonly portfolio: PaperPortfolio;
  readonly intents: IntentStore;
  readonly chains: ChainRegistry;
  /** Stamps an estimate with the time it was made. */
  readonly clock: Clock;
}

// What a quote's steps draw on: the chain's native coin, for gas and value, and the asset it spends.
function drawnAssets(built: BuiltQuote, chains: ChainRegistry): readonly AssetRef[] {
  const spent = built.quote.amountIn.asset;
  const chain = chains.get(assetRefParts(spent).chain);
  return chain.ok ? [...new Set([nativeAssetOf(chain.value), spent])] : [spent];
}

// A paper fill credits the quote's expected output, so the estimate is the quote's own amounts.
function estimateOf(built: BuiltQuote, clock: Clock): SimulatedSteps {
  const { amountIn, expectedOut } = built.quote;
  return {
    spent: [amountIn],
    received: [expectedOut],
    simulatedAt: clock.now(),
    gasUsed: 0n,
    estimated: true,
  };
}

async function simulatePaper(
  run: { readonly simulator: Simulator; readonly intent: Id<"int">; readonly built: BuiltQuote },
  call: SimulationOptions,
  clock: Clock,
): Promise<Result<SimulatedSteps, SimulationFailure>> {
  const { simulator, intent, built } = run;
  try {
    return await simulator.simulate(intent, built, call);
  } catch (error) {
    // A sale of a token whose balance the chain's simulator cannot set: nothing ran for it.
    const isUnsimulable =
      error instanceof BinferenceError &&
      error.code === "chain.balance_unset" &&
      error.details["asset"] === built.quote.amountIn.asset;
    if (isUnsimulable) {
      return ok(estimateOf(built, clock));
    }
    throw error;
  }
}

/**
 * The simulate step with a paper intent's balances: for the run, the wallet holds what its paper
 * positions hold of the chain's native coin and of the asset the quote spends, so a paper trade
 * simulates from an empty real wallet as the policy judged it. A paper sale of a token whose
 * balance the chain's simulator cannot set (`chain.balance_unset`), such as a reflection or
 * rebasing token, runs nothing: it passes as an estimate at the quote's amounts, which its card
 * says. A live intent, and one the store does not hold, simulate on the chain's balances, and a
 * live trade always needs its simulation.
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
      return simulatePaper({ simulator, intent, built }, { ...call, balances }, options.clock);
    },
  };
}
