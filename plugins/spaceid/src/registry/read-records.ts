import type { ReverseRecord } from "@binference/plugin-sdk";
import { type Address, type Hex, zeroAddress } from "viem";
import { type BnbName, namesSame, reverseNodeOf } from "../names/bnb-name.js";
import { type BlockRead, callAtBlock, unreadable } from "./read-at-block.js";
import {
  addressCallData,
  addressOf,
  expiryCallData,
  expiryOf,
  nameCallData,
  nameOf,
  resolverCallData,
  resolverOf,
} from "./space-id-calls.js";

/** The contracts a resolution reads first: the registry and the `.bnb` base registrar. */
export interface SpaceIdContracts {
  readonly registry: Address;
  readonly baseRegistrar: Address;
}

// A fixed contract's answer: a revert or an answer outside its shape is a fault.
async function readFixed<T>(
  read: BlockRead,
  call: { readonly to: Address; readonly data: Hex },
  decode: (data: Hex) => T,
): Promise<T> {
  const data = await callAtBlock(read, call);
  if (data === undefined) {
    throw unreadable("a call of the registry or the base registrar reverted.");
  }
  try {
    return decode(data);
  } catch {
    throw unreadable("the registry or the base registrar answered outside its shape.");
  }
}

// A resolver the registry named: a revert or an answer outside the shape is no record.
async function readResolver<T>(
  read: BlockRead,
  call: { readonly to: Address; readonly data: Hex },
  decode: (data: Hex) => T,
): Promise<T | undefined> {
  const data = await callAtBlock(read, call);
  try {
    return data === undefined ? undefined : decode(data);
  } catch {
    return undefined;
  }
}

/** The resolver the registry names for a node, or `undefined` for none. */
async function resolverFor(
  read: BlockRead,
  contracts: SpaceIdContracts,
  node: Hex,
): Promise<Address | undefined> {
  const call = { to: contracts.registry, data: resolverCallData(node) };
  const resolver = await readFixed(read, call, resolverOf);
  return resolver === zeroAddress ? undefined : resolver;
}

/**
 * The address record of a name at the read's block, or `undefined` when it has none: a
 * registration that ended by the block's time, no resolver, a resolver without `addr`, or the zero
 * address. Rejects when the chain does not answer, or the registry or the base registrar answers
 * outside its shape (`spaceid.read_failed`).
 */
export async function readAddressRecord(
  read: BlockRead & { readonly now: bigint },
  contracts: SpaceIdContracts,
  name: BnbName,
): Promise<Address | undefined> {
  const expiryCall = { to: contracts.baseRegistrar, data: expiryCallData(name.registration) };
  const [expires, resolver] = await Promise.all([
    readFixed(read, expiryCall, expiryOf),
    resolverFor(read, contracts, name.node),
  ]);
  if (expires <= read.now || resolver === undefined) {
    return undefined;
  }
  const call = { to: resolver, data: addressCallData(name.node) };
  const address = await readResolver(read, call, addressOf);
  return address === zeroAddress ? undefined : address;
}

/**
 * What the address's reverse record names at the read's block: `none` when it has no resolver or
 * an empty name, and `undefined` when its resolver answers no readable name. Rejects as
 * {@link readAddressRecord} does.
 */
export async function readReverseRecord(
  read: BlockRead,
  contracts: SpaceIdContracts,
  forward: { readonly address: Address; readonly name: string },
): Promise<ReverseRecord | undefined> {
  const node = reverseNodeOf(forward.address);
  const resolver = await resolverFor(read, contracts, node);
  if (resolver === undefined) {
    return { kind: "none" };
  }
  const other = await readResolver(read, { to: resolver, data: nameCallData(node) }, nameOf);
  if (other === undefined) {
    return undefined;
  }
  if (other === "") {
    return { kind: "none" };
  }
  return namesSame(other, forward.name) ? { kind: "matches" } : { kind: "differs", other };
}
