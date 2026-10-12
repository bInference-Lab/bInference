import { accountRefParts, type AssetRef, type PriceRead, type ReadCall } from "@binference/chain";
import type { Clock, Result } from "@binference/core";
import { parseEvmAddress } from "../evm-address.js";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import type { AggregateCall } from "./read-aggregate.js";
import {
  isPlanDue,
  newEntry,
  planFound,
  planMissing,
  type ReadOutcome,
  reported,
  stateOf,
  type WatchEntry,
} from "./watch-entry.js";

/** A token's price read and who declared it: a venue's id, or the pools the chain family reads. */
export interface PricePlan {
  readonly source: string;
  readonly read: PriceRead;
}

/** Why a token has no plan: no reader prices it, or the reader that would could not answer. */
export type PlanFailure = "no_price_read" | "venue_down";

/**
 * Finds how to price a token: the composition root asks the venue host, then the chain family's
 * pools. Rejects with the signal's reason once it aborts.
 */
export type PlanPrices = (
  token: AssetRef,
  signal: AbortSignal,
) => Promise<Result<PricePlan, PlanFailure>>;

/** A planned token as one block's batch reads it: its calls in Multicall3's form. */
export interface PlannedToken {
  readonly token: AssetRef;
  readonly source: string;
  readonly quoteAsset: AssetRef;
  readonly calls: readonly AggregateCall[];
  readonly price: PriceRead["price"];
}

/** Where a watched token stands: its plan is being found, it is priced each block, or it is not. */
export interface WatchedToken {
  readonly token: AssetRef;
  readonly state: "planning" | "priced" | "unpriced";
  /** Who prices it, while it is priced. */
  readonly source?: string;
}

/** The tokens a watcher reads, each once however many watch it, and their plans. */
export interface WatchList {
  /** Watches a token; the release it answers stops this one watch, once. */
  add(token: AssetRef): () => void;
  /** The tokens with a plan, in the order they were first watched. */
  planned(): readonly PlannedToken[];
  /** Starts finding a plan for each watched token that wants one now. */
  planDue(signal: AbortSignal): void;
  /** Takes what one block's read of a token's plan came to (decision 0194). */
  report(token: AssetRef, read: ReadOutcome): void;
  /** Every watched token and where it stands. */
  tokens(): readonly WatchedToken[];
}

/** What a watch list finds plans with, and how long it waits to look again. */
export interface WatchListOptions {
  readonly planPrices: PlanPrices;
  readonly clock: Clock;
  /** How long a token waits to be planned again when no reader prices it. */
  readonly noReaderMs: number;
  /**
   * How long it waits when its reader could not answer, such as for want of an RPC: about a block
   * time, so a blip costs a block, not a blind window.
   */
  readonly retryMs: number;
}

function callOf(call: ReadCall): AggregateCall | undefined {
  const target = parseEvmAddress(accountRefParts(call.target).address);
  const callData = hexSchema.safeParse(call.input);
  return target.ok && callData.success && callData.data.length > 2
    ? { target: target.value, callData: callData.data }
    : undefined;
}

// A plan the batch can carry: every call an EVM address and calldata in hex.
function plannedOf(token: AssetRef, plan: PricePlan): PlannedToken | undefined {
  const calls = plan.read.calls.map(callOf);
  const valid = calls.filter((call) => call !== undefined);
  if (valid.length === 0 || valid.length !== calls.length) {
    return undefined;
  }
  return {
    token,
    source: plan.source,
    quoteAsset: plan.read.quoteAsset,
    calls: valid,
    price: (answers) => plan.read.price(answers),
  };
}

/** The changes of a watch list's entries, each landing only on the life it was made for. */
interface Entries {
  readonly map: Map<AssetRef, WatchEntry>;
  change(token: AssetRef, life: number, next: (entry: WatchEntry) => WatchEntry): void;
}

function entriesOf(): Entries {
  const map = new Map<AssetRef, WatchEntry>();
  return {
    map,
    change(token, life, next) {
      const entry = map.get(token);
      if (entry?.life === life) {
        map.set(token, next(entry));
      }
    },
  };
}

// Finds a plan for one token in the background; a plan for a token released since is dropped. No
// plan keeps the plan in hand, and looks again after 30 s when no reader prices the token, or
// after a block time when its reader could not answer.
function planOne(
  entries: Entries,
  options: WatchListOptions,
  started: { readonly token: AssetRef; readonly life: number; readonly signal: AbortSignal },
): void {
  const { token, life } = started;
  const settle = (found: PlannedToken | PlanFailure | "fault"): void => {
    const nowMs = options.clock.now();
    const waitMs = found === "no_price_read" ? options.noReaderMs : options.retryMs;
    entries.change(token, life, (entry) =>
      typeof found === "string"
        ? planMissing(entry, { nowMs, waitMs })
        : planFound(entry, found, nowMs),
    );
  };
  entries.change(token, life, (entry) => ({ ...entry, isPlanning: true }));
  options.planPrices(token, started.signal).then(
    (found) => settle(found.ok ? (plannedOf(token, found.value) ?? "no_price_read") : found.error),
    () => settle("fault"),
  );
}

/** Creates an empty {@link WatchList}. */
export function createWatchList(options: WatchListOptions): WatchList {
  const entries = entriesOf();
  const lives = { count: 0 };
  return {
    add(token) {
      lives.count += 1;
      const entry = entries.map.get(token) ?? newEntry(lives.count);
      entries.map.set(token, { ...entry, watchers: entry.watchers + 1 });
      const watch = { isReleased: false };
      return () => {
        if (watch.isReleased) {
          return;
        }
        watch.isReleased = true;
        entries.change(token, entry.life, (now) => ({ ...now, watchers: now.watchers - 1 }));
        if (entries.map.get(token)?.watchers === 0) {
          entries.map.delete(token);
        }
      };
    },
    planned: () =>
      [...entries.map.values()].flatMap(({ plan }) => (plan === undefined ? [] : [plan])),
    planDue(signal) {
      const nowMs = options.clock.now();
      for (const [token, entry] of entries.map) {
        if (isPlanDue(entry, nowMs)) {
          planOne(entries, options, { token, life: entry.life, signal });
        }
      }
    },
    report(token, read) {
      const entry = entries.map.get(token);
      if (entry !== undefined) {
        entries.map.set(token, reported(entry, { read, nowMs: options.clock.now() }));
      }
    },
    tokens: () => [...entries.map.entries()].map(([token, entry]) => stateOf(token, entry)),
  };
}
