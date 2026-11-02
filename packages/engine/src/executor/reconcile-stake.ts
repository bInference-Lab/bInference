import type { LandedStake } from "@binference/chain/staking";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { StakeIntentQuote } from "../intents/stake-quote.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { bookStake, type StakeBooking } from "../staking/book-stake.js";
import { type ExecutionRun, moveIntent, nextBlock } from "./executor-run.js";
import { type LandedStep, landedSteps } from "./reconcile-departures.js";

// What the landed move read back, held to its plan, or `undefined` while the venue cannot say. A
// read-back the host refuses is logged with the check it failed and never booked.
async function landedOf(
  run: ExecutionRun,
  quote: StakeIntentQuote,
  step: LandedStep,
): Promise<LandedStake | undefined> {
  const { staking, log } = run.parts;
  const venue = staking?.venueOn(quote.venue, run.plan.chain.ref);
  if (staking === undefined || venue === undefined) {
    return undefined;
  }
  const { plan } = quote;
  const move = { action: plan.action, wallet: plan.wallet, validator: plan.validator };
  const landing = { move: { ...move, hash: step.txHash }, plan };
  const read = await staking.landed(venue, landing, { signal: run.signal });
  if (!read.ok && read.error === "decode_mismatch") {
    log.warn("executor.stake_landed_mismatch", {
      sourceId: quote.venue,
      errorCode: read.mismatch ?? "decode_mismatch",
    });
  }
  return read.ok ? read.value : undefined;
}

// The booking of what landed: the venue's read-back of its coin, units, request and parts, at the
// coin's price now when one is known; `undefined` while a read is missing.
async function bookingOf(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  quote: StakeIntentQuote,
): Promise<StakeBooking | undefined> {
  const [step] = await landedSteps(run, finalized);
  const landed = step === undefined ? undefined : await landedOf(run, quote, step);
  if (step === undefined || landed === undefined) {
    return undefined;
  }
  const price = await run.parts.prices.usdPrice(quote.plan.value.asset, { signal: run.signal });
  const coinPrice = price.ok && isUsablePrice(price.value) ? { coinPrice: price.value } : {};
  const { moved, shares, request, claimed } = landed;
  return {
    record: finalized.record,
    quote,
    moved,
    ...(shares === undefined ? {} : { shares }),
    ...(request === undefined ? {} : { request }),
    ...(claimed === undefined ? {} : { claimed }),
    ...coinPrice,
    gas: step.gas,
    txHash: step.txHash,
    atMs: finalized.record.changedAtMs,
  };
}

/**
 * Books what a landed staking move did, from its venue's read-back held to its plan, at the coin's
 * price now, and answers the booking; `undefined` while a read, a price or a write is missing.
 * `bookStake` books nothing twice, so a run after a stop, and a dropped step that landed after all,
 * book the move this way too.
 */
export async function bookLandedStake(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  quote: StakeIntentQuote,
): Promise<StakeBooking | undefined> {
  const booking = await bookingOf(run, snapshot, quote);
  if (booking === undefined) {
    return undefined;
  }
  const parts = {
    positions: run.parts.valuedPositions,
    unbondings: run.parts.stores.unbondings,
    booked: run.parts.positions,
  };
  return (await bookStake(parts, booking, { signal: run.signal })) ? booking : undefined;
}

/**
 * Reconciles a finalized staking move (database spec, staking; decision 0327) from what its venue
 * reads back of its landed transaction, never from its plan: a stake's minted receipt units, an
 * unstake's request with the unlock time the venue set from its landing block, and the parts a
 * claim took. The move is booked once, then the intent moves to `reconciled` with the coin and
 * units it moved. While the venue, a read or the coin's price is missing, it tries again each
 * block, up to `settleAfterBlocks`; then it leaves the intent `finalized`, and recovery
 * reconciles it after a restart.
 */
export async function reconcileStake(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  quote: StakeIntentQuote,
): Promise<void> {
  await settleStake(run, { finalized, quote }, 0);
}

async function settleStake(
  run: ExecutionRun,
  move: { readonly finalized: IntentSnapshot; readonly quote: StakeIntentQuote },
  attempt: number,
): Promise<void> {
  const { finalized, quote } = move;
  const { parts } = run;
  const intentId = finalized.record.id;
  if (attempt >= parts.limits.settleAfterBlocks) {
    parts.log.warn("executor.settle_late", { intentId });
    return;
  }
  const booking = await bookLandedStake(run, finalized, quote);
  if (booking !== undefined) {
    const { moved, shares, gas, txHash, atMs } = booking;
    const units = shares ?? moved;
    const isStake = quote.plan.action === "stake";
    const settled = {
      amountIn: isStake ? moved : units,
      amountOut: isStake ? units : moved,
      gas,
      txHashes: txHash === undefined ? [] : [txHash],
      atMs,
    };
    const ready =
      booking.request === undefined ? {} : { named: { readyAtMs: booking.request.readyAtMs } };
    await moveIntent(run, finalized, { trigger: { type: "fills_reconciled" }, settled, ...ready });
    return;
  }
  parts.log.warn("executor.settle_waits", { intentId });
  await nextBlock(run);
  await settleStake(run, move, attempt + 1);
}
