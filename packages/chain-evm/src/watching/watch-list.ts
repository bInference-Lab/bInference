import { accountRefParts, type AssetRef, type PriceRead, type ReadCall } from "@binference/chain";
import type { Clock, Result } from "@binference/core";
import { parseEvmAddress } from "../evm-address.js";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import type { AggregateCall } from "./read-aggregate.js";

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
  /** Starts finding a plan for each watched token without one whose time has come. */
  planDue(signal: AbortSignal): void;
  /** Drops a token's plan, since its answers priced nothing, and finds a new one. */
  replan(token: AssetRef): void;
  /** Every watched token and where it stands. */
  tokens(): readonly WatchedToken[];
}

/** What a watch list finds plans with, and how long it waits to look again. */
export interface WatchListOptions {
  readonly planPrices: PlanPrices;
  readonly clock: Clock;
  /**
   * How long a token waits to be planned again when no plan came, or when its plan priced nothing
   * soon after it came.
   */
  readonly replanMs: number;
}

/** One watched token. A token watched again after its last release starts a new life. */
interface Entry {
  readonly life: number;
  readonly watchers: number;
  readonly plan?: PlannedToken;
  /** When the plan in hand was found. */
  readonly plannedAtMs: number;
  readonly isPlanning: boolean;
  /** Set once a plan was looked for and none came, until one does. */
  readonly isUnpriced: boolean;
  readonly nextPlanAtMs: number;
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

function stateOf(token: AssetRef, entry: Entry): WatchedToken {
  if (entry.plan !== undefined) {
    return { token, state: "priced", source: entry.plan.source };
  }
  return { token, state: entry.isUnpriced ? "unpriced" : "planning" };
}

function withoutPlan(entry: Entry): Omit<Entry, "plan"> {
  const { plan: _plan, ...rest } = entry;
  return rest;
}

/** The changes of a watch list's entries, each landing only on the life it was made for. */
interface Entries {
  readonly map: Map<AssetRef, Entry>;
  change(token: AssetRef, life: number, next: (entry: Entry) => Entry): void;
}

function entriesOf(): Entries {
  const map = new Map<AssetRef, Entry>();
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

// Finds a plan for one token in the background; a plan for a token released since is dropped.
function planOne(
  entries: Entries,
  options: WatchListOptions,
  started: { readonly token: AssetRef; readonly life: number; readonly signal: AbortSignal },
): void {
  const { token, life } = started;
  const settle = (plan: PlannedToken | undefined): void => {
    const nowMs = options.clock.now();
    entries.change(token, life, (entry) =>
      plan === undefined
        ? {
            ...withoutPlan(entry),
            isPlanning: false,
            isUnpriced: true,
            nextPlanAtMs: nowMs + options.replanMs,
          }
        : { ...entry, plan, plannedAtMs: nowMs, isPlanning: false, isUnpriced: false },
    );
  };
  entries.change(token, life, (entry) => ({ ...entry, isPlanning: true }));
  options.planPrices(token, started.signal).then(
    (found) => settle(found.ok ? plannedOf(token, found.value) : undefined),
    () => settle(undefined),
  );
}

const newEntry = (life: number): Entry => ({
  life,
  watchers: 0,
  plannedAtMs: 0,
  isPlanning: false,
  isUnpriced: false,
  nextPlanAtMs: 0,
});

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
        if (entry.plan === undefined && !entry.isPlanning && entry.nextPlanAtMs <= nowMs) {
          planOne(entries, options, { token, life: entry.life, signal });
        }
      }
    },
    replan(token) {
      const entry = entries.map.get(token);
      if (entry?.plan !== undefined) {
        // A plan that served a while is replaced at once; one newer than that waits its turn.
        const nextPlanAtMs = Math.max(options.clock.now(), entry.plannedAtMs + options.replanMs);
        entries.map.set(token, { ...withoutPlan(entry), isUnpriced: true, nextPlanAtMs });
      }
    },
    tokens: () => [...entries.map.entries()].map(([token, entry]) => stateOf(token, entry)),
  };
}
