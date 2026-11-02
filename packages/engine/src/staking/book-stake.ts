import type { Amount, TxHash, UsdPrice } from "@binference/chain";
import type { UnbondingPart } from "@binference/chain/staking";
import { mulDiv, type Result } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { StakeIntentQuote } from "../intents/stake-quote.js";
import type { PositionStore } from "../ports.js";
import type { ArrivalDraft } from "../positions/arrival-record.js";
import type { Positions } from "../positions/create-positions.js";
import type { ExecutedTrade } from "../positions/value-execution.js";
import type { UnbondingStore } from "./ports.js";
import type { UnbondingRecord } from "./unbonding-record.js";

/**
 * What a staking move is booked into: the positions and the unbondings, and the stored executions
 * and arrivals, which say what a run before a stop booked already.
 */
export interface StakeBookParts {
  readonly positions: Positions;
  readonly unbondings: UnbondingStore;
  readonly booked: Pick<PositionStore, "executions" | "arrivals">;
}

/**
 * A staking move as it landed or filled on paper: the coin it put in, took out or claimed, the
 * receipt units a stake minted or an unstake burned, an unstake's request, the parts a claim took,
 * the coin's USD price then when one was known, the gas and the transaction on chain.
 */
export interface StakeBooking {
  readonly record: Pick<IntentRecord, "id" | "walletId" | "isPaper">;
  readonly quote: StakeIntentQuote;
  readonly moved: Amount;
  readonly shares?: Amount;
  readonly request?: UnbondingPart;
  readonly claimed?: readonly string[];
  readonly coinPrice?: UsdPrice;
  readonly gas: Amount;
  readonly txHash?: TxHash;
  readonly atMs: number;
}

interface Call {
  readonly signal: AbortSignal;
}

// A write another write beat is read and tried again, at most this many times in all.
const staleTries = 3;

async function untilFresh<T>(
  write: () => Promise<Result<T, "stale">>,
  tries = staleTries,
): Promise<boolean> {
  const written = await write();
  return written.ok || tries <= 1 ? written.ok : untilFresh(write, tries - 1);
}

// The receipt units an unstake sold, priced at the coin they took out, so the sale realizes what the
// stake earned (database spec, staking).
function sharePrice(coinPrice: UsdPrice, moved: Amount, shares: Amount): UsdPrice {
  return {
    numerator: coinPrice.numerator * moved.base,
    denominator: coinPrice.denominator * shares.base,
  };
}

// The coin's price an unbonding row recorded: its value over its amount, rounded as it was.
function rowPrice(row: UnbondingRecord): UsdPrice | undefined {
  return row.valueUsdMicros === undefined || row.amount.base === 0n
    ? undefined
    : { numerator: row.valueUsdMicros, denominator: row.amount.base };
}

function tradeOf(
  booking: StakeBooking,
  legs: {
    readonly sold: Amount;
    readonly bought: Amount;
    readonly soldPrice: UsdPrice;
    readonly gasPrice: UsdPrice;
  },
): ExecutedTrade {
  const { record, gas, txHash, atMs } = booking;
  return {
    intentId: record.id,
    walletId: record.walletId,
    isPaper: record.isPaper,
    atMs,
    feeBase: 0n,
    gas,
    ...legs,
    ...(txHash === undefined ? {} : { txHash }),
  };
}

// Whether a run before a stop stored the move's execution already.
async function hasExecution(parts: StakeBookParts, booking: StakeBooking, call: Call) {
  const { record, atMs } = booking;
  const query = { isPaper: record.isPaper, walletId: record.walletId, fromMs: atMs, toMs: atMs };
  const executions = await parts.booked.executions({ ...query, after: 0, limit: 1_000 }, call);
  return executions.some((execution) => execution.intentId === record.id);
}

// A stake spends the coin for the venue's receipt units at average cost.
async function bookStakeIn(parts: StakeBookParts, booking: StakeBooking, call: Call) {
  const { moved, shares, coinPrice } = booking;
  if (await hasExecution(parts, booking, call)) {
    return true;
  }
  if (shares === undefined || coinPrice === undefined) {
    return false;
  }
  const legs = { sold: moved, bought: shares, soldPrice: coinPrice, gasPrice: coinPrice };
  return untilFresh(async () => parts.positions.record(tradeOf(booking, legs), call));
}

// An unstake opens its unbonding first, valued at the coin's price when one is known: it opens once
// per intent, while the sale marks the move as booked, so a stop between the two leaves a run that
// opens nothing twice, and the rerun sells at the price the row recorded. Without any price, the
// row opens with no value, so a claim finds it, and the sale waits for a price.
async function bookUnstake(parts: StakeBookParts, booking: StakeBooking, call: Call) {
  const { shares, request, moved, record, quote, coinPrice } = booking;
  if (shares === undefined || request === undefined || shares.base === 0n) {
    return false;
  }
  const value =
    coinPrice === undefined ? {} : { valueUsdMicros: mulDiv(moved.base, coinPrice, "up") };
  const row = await parts.unbondings.open(
    {
      intentId: record.id,
      walletId: record.walletId,
      venue: quote.venue,
      validator: quote.plan.validator,
      requestRef: request.ref,
      amount: moved,
      readyAtMs: request.readyAtMs,
      isPaper: record.isPaper,
      ...value,
    },
    call,
  );
  if (await hasExecution(parts, booking, call)) {
    return true;
  }
  const price = rowPrice(row) ?? coinPrice;
  if (price === undefined) {
    return false;
  }
  const legs = {
    sold: shares,
    bought: moved,
    soldPrice: sharePrice(price, moved, shares),
    gasPrice: price,
  };
  return untilFresh(async () => parts.positions.unbond(tradeOf(booking, legs), call));
}

/**
 * The arrivals of a claim's coin (database spec, staking): the parts booked here with a value at
 * what their unstakes recorded, and the rest, such as a part an unstake outside binference took
 * out, with no value, which opens no position.
 */
export function claimArrivalsOf(
  rows: readonly UnbondingRecord[],
  booking: Pick<StakeBooking, "record" | "moved" | "atMs" | "txHash">,
): readonly ArrivalDraft[] {
  const { record, moved, atMs, txHash } = booking;
  const valued = rows.filter((row) => row.valueUsdMicros !== undefined);
  const valuedBase = valued.reduce((sum, row) => sum + row.amount.base, 0n);
  const value = valued.reduce((sum, row) => sum + (row.valueUsdMicros ?? 0n), 0n);
  const base = {
    walletId: record.walletId,
    isPaper: record.isPaper,
    atMs,
    ...(txHash === undefined ? {} : { txHash }),
  };
  if (valuedBase === 0n || valuedBase > moved.base) {
    return [{ ...base, received: moved }];
  }
  const rest = moved.base - valuedBase;
  const known = { ...base, received: { ...moved, base: valuedBase }, valueUsdMicros: value };
  return rest === 0n ? [known] : [known, { ...base, received: { ...moved, base: rest } }];
}

// Whether an arrival like this one is stored already: same wallet, mode, time, transaction, coin,
// amount and whether it has a value.
function isStored(stored: readonly ArrivalDraft[], arrival: ArrivalDraft): boolean {
  return stored.some(
    (item) =>
      item.txHash === arrival.txHash &&
      item.received.asset === arrival.received.asset &&
      item.received.base === arrival.received.base &&
      (item.valueUsdMicros === undefined) === (arrival.valueUsdMicros === undefined),
  );
}

// A claim marks the unbondings it took, then its coin arrives at what they recorded, each arrival
// once.
async function bookClaim(parts: StakeBookParts, booking: StakeBooking, call: Call) {
  const { record, quote, claimed = [], atMs } = booking;
  const query = {
    walletId: record.walletId,
    isPaper: record.isPaper,
    venue: quote.venue,
    validator: quote.plan.validator,
  };
  const taken =
    claimed.length === 0
      ? undefined
      : await parts.unbondings.claim(
          { ...query, claimIntentId: record.id, requestRefs: claimed, atMs },
          call,
        );
  const rows = taken?.ok === true ? taken.value : [];
  const page = { isPaper: record.isPaper, walletId: record.walletId, fromMs: atMs, toMs: atMs };
  const stored = await parts.booked.arrivals({ ...page, after: 0, limit: 1_000 }, call);
  const missing = claimArrivalsOf(rows, booking).filter((arrival) => !isStored(stored, arrival));
  const written = await Promise.all(
    missing.map(async (arrival) => untilFresh(async () => parts.positions.claim(arrival, call))),
  );
  return written.every(Boolean);
}

/**
 * Books a staking move once it landed or filled on paper (database spec, staking), and books
 * nothing twice, so a run after a stop or a repair at start may call it again: a stake as an
 * execution that spends the coin for the venue's receipt units at average cost; an unstake as an
 * execution that sells those units for the coin they took out, which realizes what the stake
 * earned, with the coin kept in an unbonding row, not in the wallet's position; a claim marks the
 * unbondings it took and moves their coin into the wallet's position at the value their unstakes
 * recorded, with no gain or loss. A write another write beat is tried again. Answers whether the
 * move is booked whole; a stake or an unstake waits for a coin price.
 */
export async function bookStake(
  parts: StakeBookParts,
  booking: StakeBooking,
  call: Call,
): Promise<boolean> {
  const { action } = booking.quote.plan;
  if (action === "unstake") {
    return bookUnstake(parts, booking, call);
  }
  return action === "claim" ? bookClaim(parts, booking, call) : bookStakeIn(parts, booking, call);
}
