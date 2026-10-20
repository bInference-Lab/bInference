import {
  type AssetRef,
  accountRefParts,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { CopyOrderRequest } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { canonicalAccount } from "../operations/canonical-account.js";

/** A copy order request that passed its rules, its leader and assets in canonical form. */
export interface CheckedCopy {
  readonly request: CopyOrderRequest;
  readonly chain: RegisteredChain;
}

const badArgs = err("protocol.bad_args" as const);

// The least dollars per buy a copy order names: a copy buy under $5 is skipped (decision 0260), so
// an order of less could never buy.
const leastPerBuyUsdMicros = 5_000_000n;

// What its buys spend: the leader's chain's coin when it names none, else a token the registry
// lists on that chain (decision 0190).
function spendOf(
  spend: AssetRef | undefined,
  found: { readonly chains: ChainRegistry; readonly chain: RegisteredChain },
): AssetRef | undefined {
  const coin = nativeAssetOf(found.chain);
  if (spend === undefined) {
    return coin;
  }
  const canonical = canonicalAsset(found.chains, spend);
  if (!canonical.ok) {
    return undefined;
  }
  const isListed =
    canonical.value === coin ||
    (assetRefParts(canonical.value).chain === found.chain.ref &&
      assetInfoOf(found.chains, canonical.value) !== undefined);
  return isListed ? canonical.value : undefined;
}

// Its terms as decision 0261 reads them: it buys, its size is its dollars per buy, a day holds at
// least one buy, and no worst price, which one token's price would set for every token.
function areTermsValid(request: CopyOrderRequest): boolean {
  const { size, trigger, side, worstPrice } = request;
  const perBuy = trigger.perBuyUsdMicros;
  return (
    side === "buy" &&
    worstPrice === undefined &&
    "usdMicros" in size &&
    size.usdMicros === perBuy &&
    perBuy >= leastPerBuyUsdMicros &&
    trigger.dailyUsdMicros >= perBuy
  );
}

/**
 * Checks a copy order request (decision 0261): a leader on a chain the registry holds, in its
 * canonical form; its `token` the coin of that chain, which names the chain whose every token the
 * order copies; a buy whose size is `{ usdMicros }` equal to `perBuyUsdMicros`, at least $5; a daily
 * cap of at least one buy; no worst price; and what its buys spend, the chain's coin by default.
 * Anything else is `protocol.bad_args`.
 */
export function checkCopyRequest(
  request: CopyOrderRequest,
  chains: ChainRegistry,
): Result<CheckedCopy, "protocol.bad_args"> {
  const leader = canonicalAccount(chains, request.trigger.leader);
  const chain = chains.get(accountRefParts(request.trigger.leader).chain);
  if (!leader.ok || !chain.ok || !areTermsValid(request)) {
    return badArgs;
  }
  const coin = nativeAssetOf(chain.value);
  const token = canonicalAsset(chains, request.token);
  const spend = spendOf(request.spend, { chains, chain: chain.value });
  if (!token.ok || token.value !== coin || spend === undefined) {
    return badArgs;
  }
  const trigger = { ...request.trigger, leader: leader.value };
  return ok({ request: { ...request, token: coin, spend, trigger }, chain: chain.value });
}
