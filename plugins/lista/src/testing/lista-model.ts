import { BinferenceError } from "@binference/plugin-sdk";
import { type Address, getAddress, type Hex } from "viem";

/** A withdrawal request the model's stake manager holds. */
export interface ModelRequest {
  readonly uuid: bigint;
  readonly units: bigint;
  readonly coin: bigint;
  readonly startTime: bigint;
}

/** A log a mined transaction wrote. */
export interface ModelLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/** Lista's stake manager and slisBNB at one block, as the model holds them. */
export interface ListaModel {
  block: bigint;
  time: bigint;
  paused: boolean;
  /** The queue holds every request, whatever its time. */
  isHeld: boolean;
  readonly minBnb: bigint;
  readonly synFee: bigint;
  readonly unbondPeriod: bigint;
  supply: bigint;
  pooled: bigint;
  nextUuid: bigint;
  readonly balances: Map<Address, bigint>;
  readonly allowances: Map<string, bigint>;
  readonly requests: Map<Address, ModelRequest[]>;
}

/** Lista's numbers on BSC as read on 2026-11-02: 1 slisBNB for about 1.0393 BNB. */
export interface ModelStart {
  readonly supply: bigint;
  readonly pooled: bigint;
  readonly minBnb: bigint;
  readonly synFee: bigint;
  readonly unbondPeriod: bigint;
  readonly time: bigint;
}

/** Makes the model at its first block. */
export function createModel(start: ModelStart): ListaModel {
  return {
    block: 1_000n,
    time: start.time,
    paused: false,
    isHeld: false,
    minBnb: start.minBnb,
    synFee: start.synFee,
    unbondPeriod: start.unbondPeriod,
    supply: start.supply,
    pooled: start.pooled,
    nextUuid: 1n,
    balances: new Map(),
    allowances: new Map(),
    requests: new Map(),
  };
}

/** A copy of the model, which later moves do not change. */
export function snapshot(model: ListaModel): ListaModel {
  return {
    ...model,
    balances: new Map(model.balances),
    allowances: new Map(model.allowances),
    requests: new Map([...model.requests].map(([wallet, list]) => [wallet, [...list]])),
  };
}

/** Whether the queue released the request: its time came and the queue is not held. */
export function isReleased(model: ListaModel, request: ModelRequest): boolean {
  return !model.isHeld && request.startTime + model.unbondPeriod <= model.time;
}

/** The slisBNB units a deposit mints, as the stake manager rounds it. */
export function mintedFor(model: ListaModel, coin: bigint): bigint {
  const supply = model.supply === 0n ? 1n : model.supply;
  const pooled = model.pooled === 0n ? 1n : model.pooled;
  return (coin * supply) / pooled;
}

/** The coin a request of the units takes out, as the stake manager rounds it. */
export function coinFor(model: ListaModel, units: bigint): bigint {
  const supply = model.supply === 0n ? 1n : model.supply;
  const pooled = model.pooled === 0n ? 1n : model.pooled;
  return (units * pooled) / supply;
}

/** A revert of a model call, as the chain would answer a failed transaction. */
export function reverted(reason: string): BinferenceError {
  return new BinferenceError({ code: "world.reverted", message: reason });
}

/** The key of an allowance of one owner to one spender. */
export const allowanceKey = (owner: Address, spender: Address): string =>
  `${getAddress(owner)} ${getAddress(spender)}`;
