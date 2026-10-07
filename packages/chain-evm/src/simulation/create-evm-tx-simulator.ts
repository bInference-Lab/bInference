import type { SimulatedStep, TxDraft, TxSimulator } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { decodeEvmDraft } from "../drafts/evm-draft.js";
import type { EvmChain } from "../evm-chain.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { type EvmCall, simulate } from "./simulate.js";

/** What the EVM transaction simulator runs on: one chain, read through its RPC failover. */
export interface EvmTxSimulatorOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
}

function callOf(chain: EvmChain, draft: TxDraft): EvmCall {
  const call = decodeEvmDraft(draft);
  if (draft.chain !== chain.ref || !call.ok) {
    throw new BinferenceError({
      code: "chain.bad_draft",
      message: `A draft to simulate is not a call on ${chain.name}.`,
      details: { chain: draft.chain },
    });
  }
  return call.value;
}

/**
 * Creates the `TxSimulator` of one EVM chain over `eth_simulateV1` with transfer traces (see
 * {@link simulate}). Validation is off, so no fee is charged and the transfers are the drafts'
 * own effects. A draft of another chain, or one the EVM family cannot read, is a `chain.bad_draft`
 * fault, and a node that refuses the simulation a `chain.simulation_failed` fault.
 */
export function createEvmTxSimulator(options: EvmTxSimulatorOptions): TxSimulator {
  const { rpc, chain } = options;
  return {
    async simulate(drafts, { signal }): Promise<readonly SimulatedStep[]> {
      signal.throwIfAborted();
      const calls = drafts.map((draft) => callOf(chain, draft));
      const simulation = await simulate(rpc, { chain, calls, signal });
      return simulation.calls.map(({ status, gasUsed, transfers, approvals }) => ({
        status,
        gasUsed,
        transfers,
        approvals,
      }));
    },
  };
}
