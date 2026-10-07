import { type Amount, assetRefParts } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, getAddress, isAddress, toHex } from "viem";
import type { EvmChain } from "../evm-chain.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { findBalanceSlot } from "./balance-slot.js";
import type { BalanceOverride, StorageOverride } from "./simulate.js";

/** The state overrides that give a holder its balances for one simulation. */
export interface HeldBalances {
  readonly balances: readonly BalanceOverride[];
  readonly storage: readonly StorageOverride[];
}

/** Whose balances to set, and to what. */
export interface HeldBalancesRequest {
  readonly chain: EvmChain;
  readonly holder: Address;
  readonly amounts: readonly Amount[];
  readonly signal: AbortSignal;
}

function badBalance(chain: EvmChain, amount: Amount): BinferenceError {
  return new BinferenceError({
    code: "chain.bad_balances",
    message: `A balance to simulate with is neither ${chain.name}'s coin nor one of its tokens.`,
    details: { asset: amount.asset },
  });
}

// An ERC-20 token of the chain, by its CAIP-19 asset type.
function tokenOf(chain: EvmChain, amount: Amount): Address {
  const { chain: ref, assetNamespace, assetReference } = assetRefParts(amount.asset);
  if (ref !== chain.ref || assetNamespace !== "erc20" || !isAddress(assetReference)) {
    throw badBalance(chain, amount);
  }
  return getAddress(assetReference);
}

interface HeldToken {
  readonly token: Address;
  readonly base: bigint;
}

async function tokenOverride(
  rpc: RpcFailover,
  request: HeldBalancesRequest,
  { token, base }: HeldToken,
): Promise<readonly StorageOverride[]> {
  const { holder, signal } = request;
  const slot = await findBalanceSlot(rpc, { token, holder, signal });
  return slot === undefined ? [] : [{ address: token, slot, value: toHex(base, { size: 32 }) }];
}

/**
 * The state overrides that make `holder` hold `amounts` in a simulation, such as a paper
 * portfolio's balances. The native coin's balance is set exactly. A token's balance is set in the
 * slot {@link findBalanceSlot} finds; a token whose slot it cannot find keeps the holder's balance
 * on the chain, so a trade the holder cannot pay for still reverts. An amount of another chain's
 * asset, or of an asset that is neither the coin nor an ERC-20 token, is a `chain.bad_balances`
 * fault.
 */
export async function heldBalances(
  rpc: RpcFailover,
  request: HeldBalancesRequest,
): Promise<HeldBalances> {
  const { chain, holder, amounts } = request;
  const native = amounts.filter((amount) => amount.asset === chain.nativeAsset);
  // Every token is read before the node is asked, so a bad balance asks nothing.
  const tokens = amounts
    .filter((amount) => amount.asset !== chain.nativeAsset)
    .map((amount) => ({ token: tokenOf(chain, amount), base: amount.base }));
  const storage = await Promise.all(tokens.map(async (held) => tokenOverride(rpc, request, held)));
  return {
    balances: native.map((amount) => ({ address: holder, balanceWei: amount.base })),
    storage: storage.flat(),
  };
}
