import type { AccountRef, Amount, AssetRef, UsdPrice } from "@binference/chain";
import { type Id, mulDiv } from "@binference/core";
import type { HeldPool } from "../staking/stake-prices.js";
import type { UnbondingRecord } from "../staking/unbonding-record.js";
import type { HeldBalance } from "./portfolio-view.js";

/** Coin an unstake took out, and when a claim can take it. */
interface HeldUnbonding {
  readonly amount: Amount;
  readonly readyAtMs: number;
}

/**
 * One wallet's stake with one validator of a venue, in one mode (decision 0329): the receipt units
 * it holds and their coin at the pool, the unbonding coin not ready yet, the coin a claim would
 * take now, and what those two are worth now. The receipt units count as a balance, so
 * `waitingUsdMicros` is all this adds to a total.
 */
export interface StakeHolding {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly venue: string;
  readonly validator: AccountRef;
  /** Absent when no pool or receipt read named the venue's receipt token. */
  readonly staked?: Amount;
  readonly stakedValue?: Amount;
  readonly unbonding: readonly HeldUnbonding[];
  readonly claimable: Amount;
  /** The unbonding and claimable coin at its price now, rounded down; absent with no price. */
  readonly waitingUsdMicros?: bigint;
}

/** What one wallet's stakes in one mode are drawn from. */
export interface StakeSources {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  /** The wallet's balances now in the mode, receipt units among them. */
  readonly balances: readonly HeldBalance[];
  /** Its unbondings no claim took. */
  readonly rows: readonly UnbondingRecord[];
  /** The pools of the receipt tokens held, by token. */
  readonly pools: ReadonlyMap<AssetRef, HeldPool>;
  /** The receipt token of each venue and validator an unbonding names and no pool does. */
  readonly receipts: ReadonlyMap<string, AssetRef>;
  /** The price now of each chain coin the unbondings hold, where one is known. */
  readonly coinPrices: ReadonlyMap<AssetRef, UsdPrice>;
  readonly nowMs: number;
}

/** The key of one venue's validator, as the stakes are grouped. */
export function stakeKeyOf(venue: string, validator: AccountRef): string {
  return `${venue} ${validator}`;
}

/** One venue's validator, with the receipt units held of it, its pool and its unbondings. */
interface Group {
  readonly venue: string;
  readonly validator: AccountRef;
  readonly staked?: Amount;
  readonly pool?: HeldPool;
  readonly rows: readonly UnbondingRecord[];
}

const sumOf = (rows: readonly UnbondingRecord[]): bigint =>
  rows.reduce((total, row) => total + row.amount.base, 0n);

// Each validator the wallet holds receipt units of, then each other one it waits for coin from.
function groupsOf(sources: StakeSources): readonly Group[] {
  const held = sources.balances.flatMap(({ amount }): Group[] => {
    const pool = sources.pools.get(amount.asset);
    return pool === undefined || amount.base === 0n
      ? []
      : [{ venue: pool.venue, validator: pool.validator, staked: amount, pool, rows: [] }];
  });
  const named = sources.rows.flatMap((row): Group[] =>
    row.validator === undefined ? [] : [{ venue: row.venue, validator: row.validator, rows: [] }],
  );
  const keyed = new Map<string, Group>();
  for (const group of [...held, ...named]) {
    const key = stakeKeyOf(group.venue, group.validator);
    if (!keyed.has(key)) {
      const rows = sources.rows.filter(
        (row) => row.validator !== undefined && stakeKeyOf(row.venue, row.validator) === key,
      );
      keyed.set(key, { ...group, rows });
    }
  }
  return [...keyed.values()];
}

// The receipt units no balance holds: none of the token the venue's pool or receipt names.
function stakedOf(group: Group, sources: StakeSources): Amount | undefined {
  if (group.staked !== undefined) {
    return group.staked;
  }
  const key = stakeKeyOf(group.venue, group.validator);
  const pooled = [...sources.pools.values()].find(
    (held) => stakeKeyOf(held.venue, held.validator) === key,
  );
  const asset = pooled?.pool.shares.asset ?? sources.receipts.get(key);
  return asset === undefined ? undefined : { asset, base: 0n };
}

// The coin the receipt units are worth at the pool, rounded down as the venue rounds.
function worthOf(group: Group, staked: Amount | undefined): { readonly stakedValue?: Amount } {
  const pool = group.pool?.pool;
  return pool === undefined || staked === undefined
    ? {}
    : {
        stakedValue: {
          asset: pool.coin.asset,
          base: (staked.base * pool.coin.base) / pool.shares.base,
        },
      };
}

function waitingOf(group: Group, sources: StakeSources, coin: AssetRef) {
  const price = sources.coinPrices.get(coin);
  const ready = group.rows.filter((row) => row.readyAtMs <= sources.nowMs);
  return {
    unbonding: group.rows
      .filter((row) => row.readyAtMs > sources.nowMs)
      .map(({ amount, readyAtMs }) => ({ amount, readyAtMs })),
    claimable: { asset: coin, base: sumOf(ready) },
    ...(price === undefined ? {} : { waitingUsdMicros: mulDiv(sumOf(group.rows), price, "down") }),
  };
}

function holdingOf(group: Group, sources: StakeSources): StakeHolding | undefined {
  const staked = stakedOf(group, sources);
  const coin = group.rows[0]?.amount.asset ?? group.pool?.pool.coin.asset;
  if (coin === undefined) {
    return undefined;
  }
  const { walletId, isPaper } = sources;
  const { venue, validator } = group;
  return {
    walletId,
    isPaper,
    venue,
    validator,
    ...(staked === undefined ? {} : { staked }),
    ...worthOf(group, staked),
    ...waitingOf(group, sources, coin),
  };
}

/**
 * One wallet's stakes in one mode (decision 0329): an entry per venue and validator it holds
 * receipt units of or waits for unstaked coin from. The receipt units are the balance of a token a
 * pool prices, and their coin the pool's share of them, rounded down as the venue rounds; each
 * unbonding no claim took is claimable once its ready time came, unbonding before, and the coin of
 * both is worth its price now, rounded down. An unbonding whose receipt token no pool or receipt
 * read names shows its coin with no receipt units.
 */
export function stakeHoldingsOf(sources: StakeSources): readonly StakeHolding[] {
  return groupsOf(sources).flatMap((group) => {
    const held = holdingOf(group, sources);
    return held === undefined ? [] : [held];
  });
}
