import type { AssetApproval, AssetTransfer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, type Hex, toHex } from "viem";
import type { EvmChain } from "../evm-chain.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import {
  type EvmLog,
  type SimulatedCallReply,
  simulationReplySchema,
} from "./simulation-reply.schema.js";
import { readApprovals, readTransfers } from "./transfer-logs.js";

/** One call to simulate, as an EVM transaction would make it. */
export interface EvmCall {
  readonly from: Address;
  readonly to: Address;
  /** Native value in wei. */
  readonly value: bigint;
  readonly data: Hex;
}

/** A native balance set before the calls run, such as for a fresh address in a risk check. */
export interface BalanceOverride {
  readonly address: Address;
  readonly balanceWei: bigint;
}

/** What to simulate: calls that run in order in one block on top of the latest state. */
export interface SimulationRequest {
  readonly chain: EvmChain;
  readonly calls: readonly EvmCall[];
  readonly balances?: readonly BalanceOverride[];
  readonly signal: AbortSignal;
}

/** What one simulated call did. */
export interface SimulatedCall {
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  /** The return data, or the revert data of a reverted call. */
  readonly returnData: Hex;
  /** Native and ERC-20 transfers, in the order they happened. */
  readonly transfers: readonly AssetTransfer[];
  readonly approvals: readonly AssetApproval[];
  /** Every log, for effects the transfers leave out, such as NFT moves. */
  readonly logs: readonly EvmLog[];
}

/** The outcome of a simulation, one entry per call. */
export interface Simulation {
  /** The block the calls ran in, one past the latest. */
  readonly blockNumber: bigint;
  readonly calls: readonly SimulatedCall[];
}

function simulationFailed(problem: string): BinferenceError {
  return new BinferenceError({
    code: "chain.simulation_failed",
    message: `The simulation failed: ${problem}`,
  });
}

function blockStateCall(request: SimulationRequest): JsonValue {
  const overrides = Object.fromEntries(
    (request.balances ?? []).map((item) => [item.address, { balance: toHex(item.balanceWei) }]),
  );
  return {
    stateOverrides: overrides,
    calls: request.calls.map((call) => ({
      from: call.from,
      to: call.to,
      value: toHex(call.value),
      data: call.data,
    })),
  };
}

function readCall(chain: EvmChain, reply: SimulatedCallReply): SimulatedCall {
  return {
    status: reply.status === 1n ? "success" : "reverted",
    gasUsed: reply.gasUsed,
    returnData: reply.returnData,
    transfers: readTransfers(chain, reply.logs),
    approvals: readApprovals(chain, reply.logs),
    logs: reply.logs,
  };
}

/**
 * Simulates calls with `eth_simulateV1` and `traceTransfers`, so native transfers come back as
 * logs beside the token transfers, then reads them into CAIP ids and amounts. Validation is off:
 * nonces and fees are not checked and gas is not charged, so the transfers are the calls' own
 * effects. A reverted call is an outcome; a node that refuses the simulation is a
 * `chain.simulation_failed` fault.
 */
export async function simulate(rpc: RpcFailover, request: SimulationRequest): Promise<Simulation> {
  const reply = await rpc.request({
    method: "eth_simulateV1",
    params: [
      { blockStateCalls: [blockStateCall(request)], traceTransfers: true, validation: false },
      "latest",
    ],
    result: simulationReplySchema,
    signal: request.signal,
  });
  if (reply.kind === "error") {
    throw simulationFailed(`${reply.endpoint} answered ${reply.message}`);
  }
  const [block] = reply.value;
  if (block?.calls.length !== request.calls.length) {
    throw simulationFailed("the node answered for another number of calls.");
  }
  return {
    blockNumber: block.number,
    calls: block.calls.map((call) => readCall(request.chain, call)),
  };
}
