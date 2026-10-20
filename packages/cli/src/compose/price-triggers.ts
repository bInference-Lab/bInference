import type { AssetRef, ChainRef } from "@binference/chain";
import type { WatchedPrice } from "@binference/chain-evm";
import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { PriceCheck } from "@binference/engine/market";
import type { WatchedOrderPrice } from "@binference/engine/orders";
import type { ChainWatch, LatestPrice } from "./chain-watch.js";
import type { Closers } from "./closers.js";
import { isConfirmed, isThin } from "./price-confirmation.js";

/** Where each confirmed price goes once the engine exists: its price triggers. */
export interface PriceTriggerLink {
  see?: Engine["seePrice"];
}

/**
 * The hand-off of one confirmed price to the engine's order triggers and its price alerts, each
 * on its own, so a failing one never keeps the price from the other; the first failure is thrown
 * once both ended.
 */
export function seeOrdersAndAlerts(
  engine: Pick<Engine, "seePrice" | "alerts">,
): NonNullable<PriceTriggerLink["see"]> {
  return async (price, call) => {
    const [orders, alerts] = await Promise.allSettled([
      engine.seePrice(price, call),
      engine.alerts.seePrice(price, call),
    ]);
    if (orders.status === "rejected") {
      throw orders.reason;
    }
    if (alerts.status === "rejected") {
      throw alerts.reason;
    }
    return orders.value;
  };
}

/**
 * A watched price as the price triggers judge it (decision 0196): only a confirmed price with a
 * USD value, of a token whose decimals are known, with whether a thin pool priced it.
 */
export function triggerPriceOf(
  price: LatestPrice,
  known: {
    readonly checks: readonly PriceCheck[];
    readonly decimals: ReadonlyMap<AssetRef, number>;
    readonly nowMs: number;
  },
): WatchedOrderPrice | undefined {
  const decimals = known.decimals.get(price.token);
  const { usdPrice } = price;
  if (usdPrice === undefined || decimals === undefined) {
    return undefined;
  }
  return isConfirmed(price, known.checks, known.nowMs)
    ? {
        token: price.token,
        usdPerBaseUnit: usdPrice,
        decimals,
        isThin: isThin(price),
        readAtMs: price.atMs,
      }
    : undefined;
}

/** What the hand-off of prices to the triggers reads. */
export interface PriceTriggerParts {
  readonly watches: ReadonlyMap<ChainRef, ChainWatch>;
  readonly decimals: ReadonlyMap<AssetRef, number>;
  readonly checks: () => readonly PriceCheck[];
  readonly clock: Clock;
  readonly link: PriceTriggerLink;
}

// The price as the chain watch kept it a moment before, with since when its plan priced it.
function latestOf(watch: ChainWatch, price: WatchedPrice): LatestPrice | undefined {
  return watch
    .latest()
    .find(
      ({ token, block, plan }) =>
        token === price.token && block === price.block && plan === price.plan,
    );
}

// One hand-off, which logs a failure, but none the shutdown caused, as it goes.
async function seeOnce(
  run: {
    readonly see: NonNullable<PriceTriggerLink["see"]>;
    readonly logger: Logger;
    readonly signal: AbortSignal;
  },
  price: WatchedOrderPrice,
): Promise<void> {
  try {
    await run.see(price, { signal: run.signal });
  } catch (error) {
    if (!run.signal.aborted) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      run.logger.warn("engine.trigger_failed", { errorCode });
    }
  }
}

/**
 * Hands each price a watcher reads to the engine's price triggers as it comes, in the block's own
 * processing, when it is confirmed (decision 0196). A hand-off runs on its own; one that fails is
 * logged as `engine.trigger_failed` with its code. The shutdown stops listening and aborts the
 * hand-offs under way.
 */
export function startPriceTriggers(
  parts: PriceTriggerParts,
  runOn: { readonly closers: Closers; readonly logger: Logger },
): void {
  const stopping = new AbortController();
  const { signal } = stopping;
  const handOn = (watch: ChainWatch, price: WatchedPrice): void => {
    const latest = latestOf(watch, price);
    const see = parts.link.see;
    const known = { checks: parts.checks(), decimals: parts.decimals, nowMs: parts.clock.now() };
    const confirmed = latest === undefined ? undefined : triggerPriceOf(latest, known);
    if (confirmed === undefined || see === undefined) {
      return;
    }
    void seeOnce({ see, logger: runOn.logger, signal }, confirmed);
  };
  const releases = [...parts.watches.values()].map((watch) =>
    watch.watcher.onPrice((price) => {
      handOn(watch, price);
    }),
  );
  runOn.closers.add("price_triggers", async () => {
    releases.forEach((release) => {
      release();
    });
    stopping.abort();
    return await Promise.resolve();
  });
}
