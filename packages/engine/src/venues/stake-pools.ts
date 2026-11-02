import { type AssetRef, accountRefParts, type ChainRegistry } from "@binference/chain";
import { type ReceiptPool, receiptPoolSchema, type StakingVenue } from "@binference/chain/staking";
import { type Clock, err, ok, type Result } from "@binference/core";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { callVenue, ownCopy } from "./call-venue.js";

/** What the pools of a staking venue are read with: the registry that names its coin, a clock. */
export interface StakePoolsOptions {
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly timeoutMs: number;
}

// One pool per receipt named, of a validator on the venue's chain, in units of the receipt and
// the chain's coin, holding some units.
function isOwnPool(
  pool: ReceiptPool,
  call: { readonly coin: AssetRef; readonly venue: StakingVenue },
) {
  return (
    accountRefParts(pool.validator).chain === call.venue.chain &&
    pool.pool.coin.asset === call.coin &&
    pool.pool.shares.base > 0n
  );
}

/**
 * The pools of the receipts named that the venue mints, as the venue reads them at the latest
 * block (decision 0329), copied: each one names a receipt asked for, once, of a validator on the
 * venue's chain, with units of it and of the chain's coin. A venue that throws, runs out of time,
 * or answers any pool outside that is `venue_down`, so no price rests on an answer the host could
 * not hold.
 */
export async function readStakePools(
  options: StakePoolsOptions,
  venue: StakingVenue,
  call: { readonly receipts: readonly AssetRef[]; readonly signal: AbortSignal },
): Promise<Result<readonly ReceiptPool[], "venue_down">> {
  const { receipts, signal } = call;
  const chain = options.chains.get(venue.chain);
  if (receipts.length === 0 || !chain.ok) {
    return ok([]);
  }
  const read = await callVenue(async (inner) => venue.pools(receipts, { signal: inner }), {
    clock: options.clock,
    signal,
    timeoutMs: options.timeoutMs,
  });
  if (!read.ok) {
    return err("venue_down");
  }
  const coin = nativeAssetOf(chain.value);
  const copies = read.value.map((pool) => ownCopy(receiptPoolSchema, pool));
  const named = new Set(receipts);
  const seen = new Set<AssetRef>();
  for (const pool of copies) {
    if (pool === undefined || !isOwnPool(pool, { coin, venue })) {
      return err("venue_down");
    }
    const receipt = pool.pool.shares.asset;
    if (!named.has(receipt) || seen.has(receipt)) {
      return err("venue_down");
    }
    seen.add(receipt);
  }
  return ok(copies.filter((pool): pool is ReceiptPool => pool !== undefined));
}
