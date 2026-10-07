import type { TxDraft } from "../transaction.js";
import type { SimulatedStep } from "./simulated-step.js";
import type { SimulationOptions } from "./simulation-options.js";

/**
 * Runs transaction drafts on their chain's latest state without sending them, and reports what
 * each one moved (ARCHITECTURE.md section 7, step 5). The drafts run in order in one block, each
 * on the state the ones before it left, as the wallet queue would send them. Adapters: the EVM
 * family's `eth_simulateV1` with transfer traces, in `@binference/chain-evm`.
 */
export interface TxSimulator {
  /**
   * One step per draft, in the drafts' order. A step that reverts is an outcome, never a throw.
   * Drafts of a chain the simulator does not serve or that its family cannot read, a balance of
   * another chain's asset, and a node that refuses the simulation are faults. Rejects with the
   * signal's reason once it aborts.
   */
  simulate(
    drafts: readonly TxDraft[],
    options: SimulationOptions,
  ): Promise<readonly SimulatedStep[]>;
}
