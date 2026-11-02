import type { Amount, AssetRef, PriceSource, UsdPrice } from "@binference/chain";
import type { StakePlan } from "@binference/chain/staking";
import type { Clock } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { paperFillOf } from "../intents/intent-history.js";
import { type StakeIntentQuote, stakeQuoteDocument } from "../intents/stake-quote.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { PaperPortfolio } from "../paper/paper-portfolio.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { type StakeBooking, type StakeBookParts, bookStake } from "./book-stake.js";

const msPerSecond = 1_000;

/** What a paper staking move fills through. */
export interface PaperStakeOptions extends StakeBookParts {
  readonly stored: StoredIntents;
  /** What each wallet holds on paper now, which a stake or an unstake must still cover. */
  readonly portfolio: Pick<PaperPortfolio, "balance">;
  readonly prices: PriceSource;
  readonly clock: Clock;
}

// The coin's USD price now; none when the source has no usable one.
async function coinPriceOf(
  options: PaperStakeOptions,
  coin: AssetRef,
  signal: AbortSignal,
): Promise<UsdPrice | undefined> {
  const price = await options.prices.usdPrice(coin, { signal });
  return price.ok && isUsablePrice(price.value) ? price.value : undefined;
}

// Whether the paper portfolio still holds what the move spends: a stake's coin, an unstake's
// receipt units, and for a claim every part its plan takes, still unclaimed.
async function holdsInput(
  options: PaperStakeOptions,
  snapshot: IntentSnapshot,
  call: { readonly plan: StakePlan; readonly venue: string; readonly signal: AbortSignal },
): Promise<boolean> {
  const { plan, venue, signal } = call;
  const { walletId } = snapshot.record;
  const spent: Amount | undefined = plan.action === "unstake" ? plan.shares : plan.value;
  if (plan.action !== "claim") {
    const held =
      spent === undefined ? 0n : await options.portfolio.balance(walletId, spent.asset, { signal });
    return spent !== undefined && held >= spent.base;
  }
  const query = { walletId, isPaper: true, venue, validator: plan.validator };
  const open = new Set(
    (await options.unbondings.listOpen(query, { signal })).map((row) => row.requestRef),
  );
  return (plan.parts ?? []).every((ref) => open.has(ref));
}

// What the fill records with its move: what left and reached the wallet's paper portfolio.
function fillOf(plan: StakePlan, atMs: number, coinPrice: UsdPrice): PaperFill {
  const units = plan.shares ?? plan.moved;
  if (plan.action === "stake") {
    return { amountIn: plan.value, amountOut: units, atMs, soldPrice: coinPrice };
  }
  return {
    amountIn: plan.action === "unstake" ? units : plan.moved,
    amountOut: plan.moved,
    atMs,
    soldPrice: coinPrice,
  };
}

// The booking of a paper staking move at its plan and its fill's time and price: no gas, and an
// unstake's coin in a paper unbonding, ready the venue's unbonding time after the fill.
function paperBookingOf(
  snapshot: IntentSnapshot,
  quote: StakeIntentQuote,
  priced: { readonly coinPrice: UsdPrice; readonly atMs: number },
): StakeBooking {
  const { record } = snapshot;
  const { plan } = quote;
  // A paper unstake waits its whole unbonding time from its fill, as a live one does from its block.
  const readyAtMs = priced.atMs + plan.unbondingSeconds * msPerSecond;
  const request =
    plan.action === "unstake"
      ? { request: { ref: `paper-${record.id}`, amount: plan.moved, readyAtMs } }
      : {};
  return {
    record,
    quote,
    moved: plan.action === "stake" ? plan.value : plan.moved,
    ...(plan.shares === undefined ? {} : { shares: plan.shares }),
    ...request,
    ...(plan.parts === undefined ? {} : { claimed: plan.parts }),
    ...priced,
    gas: { asset: plan.value.asset, base: 0n },
  };
}

// A move whose paper portfolio no longer covers it ends `failed_check` with `nothing_to_sell`.
async function endShort(
  options: PaperStakeOptions,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const machine = createIntentStateMachine({ clock: options.clock });
  const short = machine.apply(snapshot.stored.status, { type: "paper_holding_short" });
  const by = { intent: snapshot.record.id, version: snapshot.stored.version, by: "engine" };
  const moved = short.ok
    ? await options.stored.move({ ...by, step: short.value }, { signal })
    : undefined;
  return moved?.ok === true ? moved.value : snapshot;
}

/**
 * Paper mode's fill of a confirmed staking move (spec 6, section 5; decision 0327): it fills at its
 * paper plan and nothing is signed. A stake moves paper coin into the venue's receipt units; an
 * unstake sells them and its coin waits in a paper unbonding, ready the venue's unbonding time
 * after the fill, so a paper claim takes it only once that time passed; a claim moves the parts it
 * takes back into the paper coin at the value their unstakes recorded. A move whose paper portfolio
 * no longer covers it ends `failed_check` with `nothing_to_sell`; with no usable coin price it stays
 * `confirmed`, as a trade's fill does. The fill is recorded with the move to `paper_filled`, then
 * booked.
 */
export async function fillStakeOnPaper(
  options: PaperStakeOptions,
  snapshot: IntentSnapshot,
  call: { readonly signal: AbortSignal },
): Promise<IntentSnapshot> {
  const { signal } = call;
  const { record } = snapshot;
  const machine = createIntentStateMachine({ clock: options.clock });
  const step = machine.apply(snapshot.stored.status, { type: "paper_fill_recorded" });
  if (!step.ok || record.quote === undefined) {
    return snapshot;
  }
  const quote = stakeQuoteDocument.decode(record.quote);
  const { plan } = quote;
  if (!(await holdsInput(options, snapshot, { plan, venue: quote.venue, signal }))) {
    return endShort(options, snapshot, signal);
  }
  const coinPrice = await coinPriceOf(options, plan.value.asset, signal);
  if (coinPrice === undefined) {
    return snapshot;
  }
  const atMs = step.value.event.atMs;
  const fill = fillOf(plan, atMs, coinPrice);
  const by = { intent: record.id, version: snapshot.stored.version, by: "engine" };
  const moved = await options.stored.move({ ...by, step: step.value, fill }, { signal });
  if (!moved.ok) {
    return (await options.stored.snapshot(record.id, { signal })) ?? snapshot;
  }
  // A stop here leaves the paper fill without its positions or unbonding, which the start books
  // through `repairPaperStake`.
  await bookStake(options, paperBookingOf(snapshot, quote, { coinPrice, atMs }), { signal });
  return moved.value;
}

/**
 * Books a paper staking move that reached `paper_filled` again, at its fill's time and price, for
 * the start's repair of paper fills: `bookStake` books nothing twice, so a move booked whole is left
 * as it is, and one a stop cut off is finished. Answers whether it is booked whole; a move whose fill
 * kept no price or whose quote is not a stake's is left alone.
 */
export async function repairPaperStake(
  parts: StakeBookParts & { readonly stored: StoredIntents },
  intent: IntentSnapshot["record"]["id"],
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const snapshot = await parts.stored.snapshot(intent, call);
  const fill = snapshot === undefined ? undefined : paperFillOf(snapshot.history);
  const coinPrice = fill?.soldPrice;
  const { quote } = snapshot?.record ?? {};
  if (
    snapshot === undefined ||
    fill === undefined ||
    coinPrice === undefined ||
    quote === undefined
  ) {
    return false;
  }
  const booking = paperBookingOf(snapshot, stakeQuoteDocument.decode(quote), {
    coinPrice,
    atMs: fill.atMs,
  });
  return bookStake(parts, booking, call);
}
