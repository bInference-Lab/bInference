import { BinferenceError, isTxHash, type TxDraft, type TxHash } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";
import { type Address, getAddress, keccak256, numberToHex, stringToHex } from "viem";
import { type HubModel, type ModelValidator, runOnModel } from "./hub-model.js";
import { logOf, type WorldChain, type WorldReceipt, worldRpc } from "./world-chain.js";

/** StakeHub's system address on BNB Smart Chain, as the chain registry lists it. */
export const stakeHubAddress: Address = "0x0000000000000000000000000000000000002002";
/** Multicall3 on BNB Smart Chain, as the chain registry lists it. */
export const multicallAddress: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * StakeHub's parameters on BNB Smart Chain, read at block 131,098,446 on 2026-11-01 through BNB
 * Chain's public node: a 7-day unbonding time, a 1 BNB least stake, a reward day of 86,400 s.
 */
export const bscHubNumbers: {
  readonly unbondPeriod: bigint;
  readonly minDelegation: bigint;
  readonly dayLength: bigint;
} = {
  unbondPeriod: 604_800n,
  minDelegation: 10n ** 18n,
  dayLength: 86_400n,
};

/** A validator a test adds to the world. */
export interface WorldValidator {
  readonly operator: Address;
  readonly credit: Address;
  readonly moniker: string;
  readonly commissionBps: bigint;
  readonly jailUntil?: bigint;
  /** The credit contract's shares and pool when the test starts, both 0 when absent. */
  readonly supply?: bigint;
  readonly pooled?: bigint;
}

/**
 * A StakeHub world on BNB Smart Chain that a test sets up, read through an RPC failover: one block
 * a move or a wait, the state at each earlier block kept for reads at it, and each move's receipt
 * with its event.
 */
export interface StakeHubWorld {
  readonly rpc: RpcFailover;
  readonly model: HubModel;
  add(validator: WorldValidator): void;
  /** Changes a validator the world lists, such as its jail state, its pool or its rewards. */
  set(operator: Address, patch: Partial<Omit<ModelValidator, "operator" | "credit">>): void;
  /** Runs a call from the draft's sender as StakeHub does in a block of its own; a revert throws. */
  run(draft: TxDraft): TxHash;
  /** Moves the chain's time on by seconds, in a new block. */
  wait(seconds: bigint): void;
  /** Every later request rejects as no node answering. */
  down(): void;
  /** How many `eth_call`s reached the world, each a Multicall3 batch. */
  calls(): number;
}

function modelValidator(item: WorldValidator): ModelValidator {
  return {
    operator: getAddress(item.operator),
    credit: getAddress(item.credit),
    moniker: item.moniker,
    commissionBps: item.commissionBps,
    jailed: item.jailUntil !== undefined,
    jailUntil: item.jailUntil ?? 0n,
    supply: item.supply ?? 0n,
    pooled: item.pooled ?? 0n,
    balances: new Map(),
    queues: new Map(),
    sequences: new Map(),
    rewards: new Map(),
  };
}

/** The world's chain and how it moves: a block per move or wait, each move's receipt kept. */
interface WorldMoves {
  readonly chain: WorldChain;
  readonly run: (draft: TxDraft) => TxHash;
  readonly wait: (seconds: bigint) => void;
}

function createWorldMoves(time: bigint): WorldMoves {
  const model: HubModel = {
    validators: new Map(),
    blocked: new Set(),
    coded: new Set(),
    reverting: new Set(),
    ...bscHubNumbers,
    flags: { paused: false },
    clock: { time, block: 131_098_446n },
  };
  const history = new Map<bigint, HubModel>();
  const receipts = new Map<string, WorldReceipt>();
  const chain = { model, history, receipts, hub: stakeHubAddress, multicall: multicallAddress };
  // Keeps the state the latest block ended with, then starts the next block.
  const nextBlock = (): void => {
    history.set(model.clock.block, structuredClone(model));
    model.clock.block += 1n;
  };
  const run = (draft: TxDraft): TxHash => {
    nextBlock();
    const event = runOnModel(model, stakeHubAddress, draft);
    const hash = keccak256(stringToHex(`world ${String(receipts.size)}`));
    const logs = [logOf(stakeHubAddress, event)];
    receipts.set(hash, { status: "0x1", blockNumber: numberToHex(model.clock.block), logs });
    if (!isTxHash(hash)) {
      throw new BinferenceError({ code: "world.bad_hash", message: "No transaction hash." });
    }
    return hash;
  };
  const wait = (seconds: bigint): void => {
    nextBlock();
    model.clock.time += seconds;
  };
  return { chain, run, wait };
}

/** Creates a StakeHub world with BNB Smart Chain's parameters and no validator, at `time`. */
export function createStakeHubWorld(time: bigint): StakeHubWorld {
  const { chain, run, wait } = createWorldMoves(time);
  const { model } = chain;
  const asked: string[] = [];
  const down = { isDown: false };
  return {
    rpc: worldRpc(chain, { asked, isDown: () => down.isDown }),
    model,
    add: (item) => {
      const validator = modelValidator(item);
      model.validators.set(validator.operator, validator);
    },
    set: (operator, patch) => {
      const found = model.validators.get(getAddress(operator));
      if (found !== undefined) {
        model.validators.set(found.operator, { ...found, ...patch });
      }
    },
    run,
    wait,
    down: () => {
      down.isDown = true;
    },
    calls: () => asked.filter((method) => method === "eth_call").length,
  };
}
