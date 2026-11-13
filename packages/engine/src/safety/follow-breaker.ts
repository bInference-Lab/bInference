import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { AgentRecord } from "../agents/agent-record.js";
import { ownFreezeOf } from "../agents/breaker-hold.js";
import type { BreakerState } from "../breaker/breaker-state.js";
import type { StoredFreeze } from "../intents/create-stored-intents.js";
import type { BreakerWrite, FreezeCommit } from "../intents/freeze-write.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import {
  announceOrders,
  freezeOrderMoves,
  unfreezeOrderMoves,
} from "../orders/freeze-order-moves.js";
import type { BreakerSource } from "../ports.js";
import { readBreaker } from "./breaker-read.js";
import { cancelMoves, type FreezeAgentsOptions, unsignedOf } from "./freeze-agents.js";

/**
 * What one look at the breaker did (decision 0439): `unread` when its source did not answer in
 * time, with the fault's code, and nothing written; `kept` when its version was not past the one
 * applied; `pulled` or `lifted` when the engine wrote the breaker's freeze or its lift; `moved`
 * when only the version moved, the hold as it was.
 */
export type BreakerFollow =
  | { readonly outcome: "unread"; readonly errorCode: string }
  | { readonly outcome: "kept" | "pulled" | "lifted" | "moved" };

/**
 * One look and what it leaves known: the version the install holds applied and told once it
 * ended, which the next look reads no install for; absent when it read none.
 */
export interface BreakerLook {
  readonly follow: BreakerFollow;
  readonly settled?: number;
}

/** What following the breaker reads and writes through. */
export interface FollowBreakerOptions extends FreezeAgentsOptions {
  readonly source: BreakerSource;
  /** Stops every running turn of every agent the breaker now holds, as a freeze does. */
  readonly stopTurns: (signal: AbortSignal) => Promise<void>;
}

// A pull or a lift reads again and writes again when another write moved a row it read, as a
// freeze does; five rounds outlast any burst of moves a running engine makes.
const maxRounds = 5;

/** Where a write starts from: the version its plan read, and the breaker as its source said. */
interface Planned {
  readonly state: BreakerState;
  readonly fromVersion: number;
  readonly atMs: number;
}

function entryOf(
  options: FollowBreakerOptions,
  change: { readonly atMs: number; readonly kind: "freeze" | "unfreeze"; readonly version: number },
): LedgerDraft {
  const { atMs, kind, version } = change;
  return { id: options.ids.next("led"), atMs, kind, data: { by: "breaker", version } };
}

const isActive = (agent: AgentRecord): boolean => agent.archivedAtMs === undefined;

// The breaker's part of a pull or a lift, which waits to be told.
function breakerOf(planned: Planned): BreakerWrite {
  const { state, fromVersion } = planned;
  const { changedAtMs } = state;
  return {
    version: state.version,
    fromVersion,
    isPulled: state.pulled,
    isTold: false,
    ...(changedAtMs === undefined ? {} : { changedAtMs }),
  };
}

// The pull: every unsigned intent of every agent cancelled but a rescue, as a freeze does, each
// active order paused and each awaiting its card cancelled, in the breaker's own write.
async function pullOf(
  options: FollowBreakerOptions,
  planned: Planned,
  signal: AbortSignal,
): Promise<StoredFreeze> {
  const agents = (await options.agents.list({ signal })).filter(isActive);
  const listed = await Promise.all(
    agents.map(async (agent) => unsignedOf(options.intents, agent.id, { signal })),
  );
  const moves = await cancelMoves(options, listed.flat(), { by: "breaker", signal });
  const ids = agents.map((agent) => agent.id);
  const { atMs, state } = planned;
  const orders = await freezeOrderMoves(options.orders, ids, { nowMs: atMs, signal });
  const ledger = [entryOf(options, { atMs, kind: "freeze", version: state.version })];
  const rest = { agents: [], isWholeInstall: false, moves, orders, ledger };
  return { atMs, isFrozen: true, ...rest, breaker: breakerOf(planned) };
}

// The lift: the paused orders of every agent its owner has not frozen resume, in its own write.
async function liftOf(
  options: FollowBreakerOptions,
  planned: Planned,
  signal: AbortSignal,
): Promise<StoredFreeze> {
  const agents = await options.agents.list({ signal });
  const free = agents.filter((agent) => isActive(agent) && ownFreezeOf(agent) === undefined);
  const ids = free.map((agent) => agent.id);
  const { atMs, state } = planned;
  const orders = await unfreezeOrderMoves(options.orders, ids, { nowMs: atMs, signal });
  const ledger = [entryOf(options, { atMs, kind: "unfreeze", version: state.version })];
  const rest = { agents: [], isWholeInstall: false, moves: [], orders, ledger };
  return { atMs, isFrozen: false, ...rest, breaker: breakerOf(planned) };
}

// A version that moves nothing the install holds: only the version is written, told with it.
function movedOf(planned: Planned): StoredFreeze {
  const empty = { agents: [], moves: [], orders: [], ledger: [] };
  const { atMs, state } = planned;
  const breaker = { ...breakerOf(planned), isTold: true };
  return { atMs, isFrozen: state.pulled, isWholeInstall: false, ...empty, breaker };
}

type Applied = Exclude<BreakerFollow["outcome"], "unread">;

// The write a version past the one the install applied asks for, planned on the version read.
async function writeOf(
  options: FollowBreakerOptions,
  state: BreakerState,
  signal: AbortSignal,
): Promise<{ readonly outcome: Applied; readonly write?: StoredFreeze }> {
  const facts = await options.install.read({ signal });
  const fromVersion = facts.breakerVersion ?? 0;
  if (state.version <= fromVersion) {
    return { outcome: "kept" };
  }
  const isHeld = facts.breakerAtMs !== undefined;
  const planned = { state, fromVersion, atMs: options.clock.now() };
  if (state.pulled && !isHeld) {
    return { outcome: "pulled", write: await pullOf(options, planned, signal) };
  }
  if (!state.pulled && isHeld) {
    return { outcome: "lifted", write: await liftOf(options, planned, signal) };
  }
  return { outcome: "moved", write: movedOf(planned) };
}

async function applyOnce(
  options: FollowBreakerOptions,
  state: BreakerState,
  signal: AbortSignal,
): Promise<Result<{ readonly outcome: Applied; readonly commit?: FreezeCommit }, "stale">> {
  const { outcome, write } = await writeOf(options, state, signal);
  if (write === undefined) {
    return ok({ outcome });
  }
  const commit = await options.stored.freeze(write, { signal });
  return commit.ok ? ok({ outcome, commit: commit.value }) : err("stale");
}

async function applyFrom(
  options: FollowBreakerOptions,
  at: { readonly state: BreakerState; readonly round: number },
  signal: AbortSignal,
): Promise<{ readonly outcome: Applied; readonly commit?: FreezeCommit }> {
  const applied = await applyOnce(options, at.state, signal);
  if (applied.ok) {
    return applied.value;
  }
  if (at.round >= maxRounds) {
    throw new BinferenceError({
      code: "engine.freeze_contended",
      message: `Other writes moved the rows the breaker's write read ${String(maxRounds)} times.`,
      retryable: true,
    });
  }
  return applyFrom(options, { ...at, round: at.round + 1 }, signal);
}

/**
 * Tells the owner of the version the install applied, once (decision 0440): a pull stops every
 * running turn; then the version is marked told. A version alone was told with its write, and a
 * fault before the mark leaves it to the next look. Answers the version applied.
 */
async function tellApplied(options: FollowBreakerOptions, signal: AbortSignal): Promise<number> {
  const facts = await options.install.read({ signal });
  const applied = facts.breakerVersion ?? 0;
  if ((facts.breakerToldVersion ?? 0) >= applied) {
    return applied;
  }
  if (facts.breakerAtMs !== undefined) {
    await options.stopTurns(signal);
  }
  await options.install.tellBreaker(applied, { signal });
  return applied;
}

/**
 * Follows the breaker (decisions 0439 and 0440): reads its source within its deadline and, once
 * its version is past the one the install applied, writes the breaker's freeze, its lift, or the
 * version alone, once, planned on the version the install held. A pull cancels every unsigned
 * intent but a rescue, pauses each active auto order and cancels each awaiting its card, in the
 * breaker's own write, then stops every running turn; a lift resumes the paused orders of every
 * agent its owner has not frozen. Neither writes an owner's freeze. A pull or a lift not yet told
 * is told first, so a fault after a write loses nothing. A source that does not answer in time
 * writes nothing and answers `unread`, so the install keeps the state it applied last; a version
 * equal to `known`, the one the last look left applied and told, reads no install. A write
 * another write beat is planned again; a store fault, a lost lease among them, rejects.
 */
export async function followBreaker(
  options: FollowBreakerOptions,
  look: { readonly signal: AbortSignal; readonly known?: number },
): Promise<BreakerLook> {
  const { signal, known } = look;
  const state = await readBreaker(options, signal);
  if (!state.ok) {
    return { follow: { outcome: "unread", errorCode: state.error } };
  }
  if (state.value.version === known) {
    return { follow: { outcome: "kept" }, settled: known };
  }
  const told = await tellApplied(options, signal);
  if (state.value.version <= told) {
    return { follow: { outcome: "kept" }, settled: told };
  }
  const { outcome, commit } = await applyFrom(options, { state: state.value, round: 1 }, signal);
  if (commit !== undefined) {
    announceOrders(options.publish, commit.orders);
  }
  return { follow: { outcome }, settled: await tellApplied(options, signal) };
}
