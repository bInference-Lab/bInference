import type { AssetRef } from "@binference/chain";
import type { GasReserve, LimitsValues, PendingLimits } from "../agents/limits-record.js";
import { looseningWaitMs } from "./send-level-change.js";

/** Changes to some of an agent's limits; a limit left out stays. */
export type LimitChanges = Partial<LimitsValues>;

/** One of an agent's limits, by its name in `LimitsValues`. */
export type LimitName = keyof LimitsValues;

/** An agent's limits as they were written, and looser ones that wait for their time. */
export interface LimitsState {
  readonly values: LimitsValues;
  readonly pending?: PendingLimits;
}

/** What a request for new limits does: the state to write, and the limits that moved. */
export interface LimitsMove {
  readonly next: LimitsState;
  /** The limits that change at once: each new value is clearly stricter. */
  readonly stricter: readonly LimitName[];
  /** The limits that wait 24 hours: every other change. A caller needs `loosen` for them. */
  readonly looser: readonly LimitName[];
}

/** How one limit compares: whether two values are the same, and whether one is stricter. */
interface Comparison {
  readonly isSame: (before: LimitsValues, after: LimitsValues) => boolean;
  /** Whether `after` is clearly stricter than `before`, or the same. */
  readonly isStricter: (before: LimitsValues, after: LimitsValues) => boolean;
}

type Read<T> = (values: LimitsValues) => T;

function lowerIsStricter(read: Read<bigint | number>): Comparison {
  return {
    isSame: (before, after) => read(before) === read(after),
    isStricter: (before, after) => read(after) <= read(before),
  };
}

function higherIsStricter(read: Read<bigint | number>): Comparison {
  return {
    isSame: (before, after) => read(before) === read(after),
    isStricter: (before, after) => read(after) >= read(before),
  };
}

function isSubset<T>(items: readonly T[], of: readonly T[]): boolean {
  return items.every((item) => of.includes(item));
}

function isSameSet<T>(read: Read<readonly T[]>): Comparison["isSame"] {
  return (before, after) =>
    isSubset(read(before), read(after)) && isSubset(read(after), read(before));
}

function reserveOn(reserves: readonly GasReserve[], chain: GasReserve["chain"]): bigint {
  return reserves.find((reserve) => reserve.chain === chain)?.reserveBase ?? 0n;
}

// Every chain keeps at least the reserve it kept.
function reservesAtLeast(before: readonly GasReserve[], after: readonly GasReserve[]): boolean {
  return before.every((reserve) => reserveOn(after, reserve.chain) >= reserve.reserveBase);
}

// An empty allow list allows every token, so only a list that is not empty narrows it.
function narrowsAllowList(before: readonly AssetRef[], after: readonly AssetRef[]): boolean {
  return after.length > 0 && (before.length === 0 || isSubset(after, before));
}

// How each limit compares (decision 0111): a cap, a rate or a time is stricter lower, a floor and
// a health factor higher; fewer venues, a smaller allow list that is not empty, a larger deny list
// and a larger gas reserve are stricter.
const comparisons: { readonly [N in LimitName]: Comparison } = {
  perTradeUsdMicros: lowerIsStricter((v) => v.perTradeUsdMicros),
  rollingDayUsdMicros: lowerIsStricter((v) => v.rollingDayUsdMicros),
  slippageRegistryBps: lowerIsStricter((v) => v.slippageRegistryBps),
  slippageOtherBps: lowerIsStricter((v) => v.slippageOtherBps),
  priceImpactBps: lowerIsStricter((v) => v.priceImpactBps),
  taxBps: lowerIsStricter((v) => v.taxBps),
  liquidityFloorUsdMicros: higherIsStricter((v) => v.liquidityFloorUsdMicros),
  minHealthFactorBp: higherIsStricter((v) => v.minHealthFactorBp),
  gasReserve: {
    isSame: (before, after) =>
      reservesAtLeast(before.gasReserve, after.gasReserve) &&
      reservesAtLeast(after.gasReserve, before.gasReserve),
    isStricter: (before, after) => reservesAtLeast(before.gasReserve, after.gasReserve),
  },
  venues: {
    isSame: isSameSet((v) => v.venues),
    isStricter: (before, after) => isSubset(after.venues, before.venues),
  },
  allowTokens: {
    isSame: isSameSet((v) => v.allowTokens),
    isStricter: (before, after) =>
      isSameSet<AssetRef>((v) => v.allowTokens)(before, after) ||
      narrowsAllowList(before.allowTokens, after.allowTokens),
  },
  denyTokens: {
    isSame: isSameSet((v) => v.denyTokens),
    isStricter: (before, after) => isSubset(before.denyTokens, after.denyTokens),
  },
  modelBudgetUsdMicros: lowerIsStricter((v) => v.modelBudgetUsdMicros),
  cardTradeExpiryS: lowerIsStricter((v) => v.cardTradeExpiryS),
  cardOtherExpiryS: lowerIsStricter((v) => v.cardOtherExpiryS),
  requoteAfterS: lowerIsStricter((v) => v.requoteAfterS),
  requoteToleranceBps: lowerIsStricter((v) => v.requoteToleranceBps),
  orderExpiryDays: lowerIsStricter((v) => v.orderExpiryDays),
  copyPerBuyUsdMicros: lowerIsStricter((v) => v.copyPerBuyUsdMicros),
  copyPerLeaderDayUsdMicros: lowerIsStricter((v) => v.copyPerLeaderDayUsdMicros),
};

function isLimitName(name: string): name is LimitName {
  return Object.hasOwn(comparisons, name);
}

// Every limit, in the order `LimitsValues` names them.
const limitNames: readonly LimitName[] = Object.keys(comparisons).filter(isLimitName);

// Whether two sets of limits allow and refuse the same.
function isSameLimits(left: LimitsValues, right: LimitsValues): boolean {
  return limitNames.every((name) => comparisons[name].isSame(left, right));
}

function withLimit(base: LimitsValues, from: LimitsValues, name: LimitName): LimitsValues {
  return { ...base, [name]: from[name] };
}

function withLimits(
  base: LimitsValues,
  from: LimitsValues,
  names: readonly LimitName[],
): LimitsValues {
  return names.reduce((values, name) => withLimit(values, from, name), base);
}

/**
 * The limits in effect at `nowMs`: limits that waited and whose time has come replace the limits,
 * and ones still waiting stay pending. Every reader of a stored state goes through this.
 */
export function limitsAt(state: LimitsState, nowMs: number): LimitsState {
  const { values, pending } = state;
  if (pending !== undefined && pending.atMs <= nowMs) {
    return { values: pending.values };
  }
  return pending === undefined ? { values } : { values, pending };
}

// The time the pending limits take effect: kept when no looser limit changed what waits.
function pendingTime(
  settled: LimitsState,
  move: {
    readonly asked: LimitsValues;
    readonly looser: readonly LimitName[];
    readonly nowMs: number;
  },
): number {
  const { pending } = settled;
  const isKept =
    pending !== undefined &&
    move.looser.every((name) => comparisons[name].isSame(pending.values, move.asked));
  return isKept ? pending.atMs : move.nowMs + looseningWaitMs;
}

/**
 * Moves an agent's limits toward the changes asked, judged against the limits in effect at
 * `nowMs` (decision 0111). A clearly stricter value, or the value in effect, applies at once and
 * drops any looser value of the same limit that waits. Every other change waits 24 hours; asking
 * again for the values that wait keeps their time, and any other looser change starts the wait
 * again for all of them.
 */
export function moveLimits(state: LimitsState, changes: LimitChanges, nowMs: number): LimitsMove {
  const settled = limitsAt(state, nowMs);
  const asked: LimitsValues = { ...settled.values, ...changes };
  const named = limitNames.filter((name) => changes[name] !== undefined);
  const changed = named.filter((name) => !comparisons[name].isSame(settled.values, asked));
  const stricter = changed.filter((name) => comparisons[name].isStricter(settled.values, asked));
  const looser = changed.filter((name) => !stricter.includes(name));
  const values = withLimits(settled.values, asked, stricter);
  // Every limit named, the ones asked at their value in effect too, drops its looser value.
  const waiting = withLimits(settled.pending?.values ?? settled.values, asked, named);
  if (isSameLimits(values, waiting)) {
    return { next: { values }, stricter, looser };
  }
  const atMs =
    looser.length === 0 && settled.pending !== undefined
      ? settled.pending.atMs
      : pendingTime(settled, { asked, looser, nowMs });
  return { next: { values, pending: { values: waiting, atMs } }, stricter, looser };
}

/** Drops the looser limits that wait at `nowMs`; the limits in effect stay. */
export function cancelLimits(state: LimitsState, nowMs: number): LimitsState {
  return { values: limitsAt(state, nowMs).values };
}

/** The limits that differ between two sets, in the order `LimitsValues` names them. */
export function limitsChanged(before: LimitsValues, after: LimitsValues): readonly LimitName[] {
  return limitNames.filter((name) => !comparisons[name].isSame(before, after));
}
