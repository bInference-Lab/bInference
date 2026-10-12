import type { AssetRef } from "@binference/chain";
import type { PlannedToken, WatchedToken } from "./watch-list.js";

/**
 * What one block's read of a token's plan came to: priced; nothing priced; a plan that no longer
 * holds; or calls that failed the block's whole batch, which leave it (decision 0194).
 */
export type ReadOutcome = "priced" | "unpriced" | "replan" | "quarantined";

/** One watched token. A token watched again after its last release starts a new life. */
export interface WatchEntry {
  readonly life: number;
  readonly watchers: number;
  readonly plan?: PlannedToken;
  /** When the plan in hand was found. */
  readonly plannedAtMs: number;
  /** Blocks in a row whose answers priced nothing with the plan in hand. */
  readonly misses: number;
  readonly isPlanning: boolean;
  /** Whether a plan, or a new one beside the one in hand, is wanted from `nextPlanAtMs`. */
  readonly wantsPlan: boolean;
  readonly nextPlanAtMs: number;
  /** Set once the token has no plan after one was looked for, until one comes. */
  readonly isUnpriced: boolean;
}

// A plan is kept through this many blocks in a row whose answers price nothing (decision 0194).
const maxMisses = 3;
// A plan that says it no longer holds this soon after it came waits this long for the next.
const replanGuardMs = 2_000;

/** A token first watched, which wants a plan at once. */
export function newEntry(life: number): WatchEntry {
  return {
    life,
    watchers: 0,
    plannedAtMs: 0,
    misses: 0,
    isPlanning: false,
    wantsPlan: true,
    nextPlanAtMs: 0,
    isUnpriced: false,
  };
}

/** Whether the entry's next plan is due now and not being found. */
export function isPlanDue(entry: WatchEntry, nowMs: number): boolean {
  return entry.wantsPlan && !entry.isPlanning && entry.nextPlanAtMs <= nowMs;
}

/** A new plan replaces the one in hand. */
export function planFound(entry: WatchEntry, plan: PlannedToken, nowMs: number): WatchEntry {
  return {
    ...entry,
    plan,
    plannedAtMs: nowMs,
    misses: 0,
    isPlanning: false,
    wantsPlan: false,
    isUnpriced: false,
  };
}

/** No plan came: the plan in hand, if any, prices on, and the next look is `waitMs` away. */
export function planMissing(
  entry: WatchEntry,
  at: { readonly nowMs: number; readonly waitMs: number },
): WatchEntry {
  return {
    ...entry,
    isPlanning: false,
    wantsPlan: true,
    nextPlanAtMs: at.nowMs + at.waitMs,
    isUnpriced: entry.plan === undefined,
  };
}

function withoutPlan(entry: WatchEntry): Omit<WatchEntry, "plan"> {
  const { plan: _plan, ...rest } = entry;
  return rest;
}

/** A plan whose calls failed a whole batch leaves the batch, and the next look is at `untilMs`. */
export function quarantined(entry: WatchEntry, untilMs: number): WatchEntry {
  return {
    ...withoutPlan(entry),
    misses: 0,
    wantsPlan: true,
    nextPlanAtMs: untilMs,
    isUnpriced: true,
  };
}

/**
 * Takes one block's outcome of the plan in hand. A priced block clears the misses; a plan whose
 * answers price nothing three blocks in a row is kept while a new one is found; a plan whose
 * answers say it no longer holds is dropped and a new one found at once, or 2 s after it came.
 */
export function reported(
  entry: WatchEntry,
  outcome: { readonly read: Exclude<ReadOutcome, "quarantined">; readonly nowMs: number },
): WatchEntry {
  if (outcome.read === "priced") {
    return { ...entry, misses: 0 };
  }
  if (outcome.read === "replan") {
    const nextPlanAtMs = Math.max(outcome.nowMs, entry.plannedAtMs + replanGuardMs);
    return { ...withoutPlan(entry), misses: 0, wantsPlan: true, nextPlanAtMs, isUnpriced: true };
  }
  const misses = entry.misses + 1;
  const isDueAgain = misses >= maxMisses && !entry.wantsPlan;
  return isDueAgain
    ? { ...entry, misses, wantsPlan: true, nextPlanAtMs: outcome.nowMs }
    : { ...entry, misses };
}

/**
 * Where a watched token stands: priced while its plan priced the last block read, unpriced while
 * that block priced nothing or no plan came.
 */
export function stateOf(token: AssetRef, entry: WatchEntry): WatchedToken {
  if (entry.plan !== undefined && entry.misses === 0) {
    return { token, state: "priced", source: entry.plan.source };
  }
  const isUnpriced = entry.isUnpriced || entry.misses > 0;
  return { token, state: isUnpriced ? "unpriced" : "planning" };
}
