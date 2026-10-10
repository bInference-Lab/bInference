import type { ChainRef, ChainRegistry, TxSimulator } from "@binference/chain";
import { createEvmTxSimulator } from "@binference/chain-evm";
import { BinferenceError, type Clock } from "@binference/core";
import type { Simulator } from "@binference/engine";
import { createSimulationCheck } from "@binference/engine/simulation";
import type { ChainReads } from "./chain-reads.js";

/**
 * A transaction simulator that runs drafts on their own chain's simulator: the first draft's
 * chain decides. A chain it has no simulator for is a `cli.no_chain_parts` fault; no drafts run
 * nothing.
 */
export function txSimulatorRouterOf(simulators: ReadonlyMap<ChainRef, TxSimulator>): TxSimulator {
  return {
    async simulate(drafts, options) {
      options.signal.throwIfAborted();
      const [first] = drafts;
      if (first === undefined) {
        return [];
      }
      const simulator = simulators.get(first.chain);
      if (simulator === undefined) {
        throw new BinferenceError({
          code: "cli.no_chain_parts",
          message: `No chain parts are set up for ${first.chain}.`,
          details: { chain: first.chain },
        });
      }
      return simulator.simulate(drafts, options);
    },
  };
}

/** The chain's simulator, and the engine's simulate step over it. */
export interface ComposedSimulators {
  /** Runs drafts unsent: the risk step's round trip and a rescue's sends. */
  readonly txSimulator: TxSimulator;
  /** The money path's simulate step, which checks a quote's steps against its terms. */
  readonly simulator: Simulator;
}

/**
 * The self-hosted simulators: for each chain the reads hold, `eth_simulateV1` with transfer
 * traces over the chain's one RPC failover, which also reports the gas each step used (decision
 * 0107); the engine's simulation check runs over them.
 */
export function composeSimulators(
  reads: ReadonlyMap<ChainRef, ChainReads>,
  options: { readonly chains: ChainRegistry; readonly clock: Clock },
): ComposedSimulators {
  const simulators = [...reads].map(([chain, { rpc, evm }]): [ChainRef, TxSimulator] => [
    chain,
    createEvmTxSimulator({ rpc, chain: evm }),
  ]);
  const txSimulator = txSimulatorRouterOf(new Map(simulators));
  return {
    txSimulator,
    simulator: createSimulationCheck({ simulator: txSimulator, ...options }),
  };
}
