import { type AssetRef, assetRefParts, type PriceSource, type UsdPrice } from "@binference/chain";
import type { Clock } from "@binference/core";
import { bridgesInTransit, type TransitParts } from "../bridges/bridges-in-transit.js";
import type { WalletRecord } from "../install/install-record.js";
import { createPositions } from "../positions/create-positions.js";
import type { PositionRecord } from "../positions/position-record.js";
import { isUsablePrice } from "../positions/value-execution.js";
import type { UnbondingStore } from "../staking/ports.js";
import { type HeldPool, stakePricesOf } from "../staking/stake-prices.js";
import type { UnbondingRecord } from "../staking/unbonding-record.js";
import type { StakingHost } from "../venues/staking-host.js";
import { type LiveHoldingsOptions, liveHoldingsOf } from "./live-holdings.js";
import { type HeldElsewhere, paperHoldingsOf, type WalletHoldings } from "./portfolio-view.js";
import { stakeHoldingsOf, stakeKeyOf } from "./stake-holdings.js";

/**
 * What a portfolio's holdings are read through: the wallets' balances and positions, the staking
 * venues that price their receipt tokens, the unbondings no claim took, and the bridges in transit
 * with their intents.
 */
export interface HoldingsReadParts extends LiveHoldingsOptions, TransitParts {
  readonly staking: StakingHost;
  readonly unbondings: Pick<UnbondingStore, "openOf">;
  readonly clock: Clock;
}

/** The wallets' holdings in both modes, and what they hold beside their balances. */
export interface ReadHoldings {
  readonly holdings: readonly WalletHoldings[];
  readonly elsewhere: HeldElsewhere;
}

interface Call {
  readonly signal: AbortSignal;
}

/** One wallet's stored positions and unbondings in one mode. */
interface Stored {
  readonly wallet: WalletRecord;
  readonly isPaper: boolean;
  readonly positions: readonly PositionRecord[];
  readonly rows: readonly UnbondingRecord[];
}

const modes = [{ isPaper: false }, { isPaper: true }] as const;

async function storedOf(
  parts: HoldingsReadParts,
  wallets: readonly WalletRecord[],
  call: Call,
): Promise<readonly Stored[]> {
  return Promise.all(
    wallets.flatMap((wallet) =>
      modes.map(async ({ isPaper }) => {
        const query = { walletId: wallet.id, isPaper };
        const [positions, rows] = await Promise.all([
          parts.store.positions(query, call),
          parts.unbondings.openOf(query, call),
        ]);
        return { wallet, isPaper, positions, rows };
      }),
    ),
  );
}

// The receipt token of each venue's validator an unbonding names and no pool does, read from the
// venue; one the engine does not run, or that does not answer, names none.
async function rowReceipts(
  parts: HoldingsReadParts,
  held: {
    readonly rows: readonly UnbondingRecord[];
    readonly pools: ReadonlyMap<AssetRef, HeldPool>;
  },
  call: Call,
): Promise<ReadonlyMap<string, AssetRef>> {
  const { rows, pools } = held;
  const pooled = new Set([...pools.values()].map((pool) => stakeKeyOf(pool.venue, pool.validator)));
  const read = await Promise.all(
    rows.map(async ({ venue: id, validator, amount }) => {
      const venue = parts.staking.venueOn(id, assetRefParts(amount.asset).chain);
      if (venue === undefined || validator === undefined || pooled.has(stakeKeyOf(id, validator))) {
        return [];
      }
      const receipt = await parts.staking.receipt(venue, validator, call);
      return receipt.ok ? [[stakeKeyOf(id, validator), receipt.value] as const] : [];
    }),
  );
  return new Map(read.flat());
}

// The price now of each coin the unbondings hold, where a usable one is known.
async function coinPricesOf(
  parts: HoldingsReadParts,
  rows: readonly UnbondingRecord[],
  call: Call,
): Promise<ReadonlyMap<AssetRef, UsdPrice>> {
  const coins = [...new Set(rows.map((row) => row.amount.asset))];
  const read = await Promise.all(
    coins.map(async (coin) => [coin, await parts.prices.usdPrice(coin, call)] as const),
  );
  return new Map(
    read.flatMap(([coin, price]) =>
      price.ok && isUsablePrice(price.value) ? [[coin, price.value] as const] : [],
    ),
  );
}

// Each wallet's balances and positions in each mode, in the order stored, each receipt token
// valued at its pool.
async function valuedHoldings(
  parts: HoldingsReadParts,
  held: { readonly stored: readonly Stored[]; readonly prices: PriceSource },
  call: Call,
): Promise<readonly WalletHoldings[]> {
  const { prices } = held;
  const valuing = { ...parts, prices, positions: createPositions({ store: parts.store, prices }) };
  return Promise.all(
    held.stored.map(async ({ wallet, isPaper }) =>
      isPaper
        ? paperHoldingsOf(
            wallet.id,
            await valuing.positions.value({ walletId: wallet.id, isPaper }, call),
          )
        : liveHoldingsOf(valuing, wallet, call),
    ),
  );
}

/**
 * Reads what the wallets hold now, live and paper (decision 0329): each wallet's balances, live
 * as the chain reads them and paper as its paper positions hold them, with its positions, each
 * receipt token of a staking venue valued at its pool; each wallet's stakes in each mode with
 * their unbonding coin; and its bridges in transit. A staking venue that does not answer leaves
 * the tokens it mints with no value and no stake entry, and an unbonding it would name with no
 * receipt units, never failing the read (decision 0329); a chain that cannot be read throws, as
 * `liveHoldingsOf` does.
 */
export async function readHoldings(
  parts: HoldingsReadParts,
  wallets: readonly WalletRecord[],
  call: Call,
): Promise<ReadHoldings> {
  const stored = await storedOf(parts, wallets, call);
  const { pools, prices } = await stakePricesOf(
    parts,
    stored.flatMap((held) => held.positions.map(({ asset }) => asset)),
    call,
  );
  const rows = stored.flatMap((held) => held.rows);
  const [receipts, coinPrices] = await Promise.all([
    rowReceipts(parts, { rows, pools }, call),
    coinPricesOf(parts, rows, call),
  ]);
  const holdings = await valuedHoldings(parts, { stored, prices }, call);
  const nowMs = parts.clock.now();
  const staking = stored.flatMap((held, index) =>
    stakeHoldingsOf({
      walletId: held.wallet.id,
      isPaper: held.isPaper,
      balances: holdings[index]?.balances ?? [],
      rows: held.rows,
      pools,
      receipts,
      coinPrices,
      nowMs,
    }),
  );
  const live = new Set(wallets.map(({ id }) => id));
  const inTransit = await bridgesInTransit(parts, live, call);
  return { holdings, elsewhere: { staking, inTransit } };
}
