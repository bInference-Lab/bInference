import { BinferenceError, type Clock, type Id, type JsonValue } from "@binference/core";
import { allOrdersIn } from "../orders/all-orders.js";
import { announceRows } from "../orders/fill-ends.js";
import { paceRows } from "../orders/fill-pacing.js";
import { hasPriceTrigger } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { checkedOrdersOf } from "./checked-orders.js";
import type { DowntimeCheck, OpenCheck } from "./downtime-check.js";
import { type DowntimeReport, resumedNotice, resumeReportPayload } from "./downtime-report.js";
import type { AliveStore } from "./ports.js";

/** One resume's re-check under way: its report, once it went out. */
export interface DowntimeRun {
  /** Resolves with the report once the owner and the agents got it; rejects on a store fault. */
  readonly reported: Promise<DowntimeReport>;
}

/**
 * A pause the composition root found while the engine runs: a jump of the wall clock past its
 * timer's sleep (`wake`, as when the machine slept), or the wall clock set back (`clock`), and how
 * long it lasted or how far the clock went back.
 */
export interface Pause {
  readonly cause: "wake" | "clock";
  /** The wall clock's time when the pause began. */
  readonly fromMs: number;
  readonly offMs: number;
}

/**
 * The downtime re-check (decisions 0266 and 0267): a start after a stop, or a pause of the engine
 * found while it runs, re-checks every auto order once and sends one report when it checked one.
 * The composition root calls `started` at the start, before any price reaches the triggers,
 * `paused` the moment it finds a pause, and `alive` about once a minute and as the engine stops.
 */
export interface Downtime {
  /**
   * The start's re-check, from when the engine last ran to now; none at the install's first
   * start, which only marks the engine alive.
   */
  started(options: { readonly signal: AbortSignal }): Promise<DowntimeRun | undefined>;
  /**
   * A pause's re-check, joined to the open one. Before it awaits anything, it fences off every
   * price read and every judgment made before it (decision 0268).
   */
  paused(pause: Pause, options: { readonly signal: AbortSignal }): Promise<DowntimeRun>;
  /** Marks the engine alive now, unless a re-check is open: its stop leaves the earlier mark. */
  alive(options: { readonly signal: AbortSignal }): Promise<void>;
  /**
   * Hands the fence the composition root's check for a pause: every question of whether a price
   * or a fill is stale asks it first, so the first one after a sleep finds the sleep.
   */
  findPausesWith(findPause: () => boolean): void;
}

/** What the re-check reads, waits on, and tells through. */
export interface DowntimeParts {
  readonly orders: OrderStore;
  readonly alive: AliveStore;
  readonly check: DowntimeCheck;
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** Stores an agent's `inbox/resumeReport` and pushes it; one the inbox has no room for is dropped. */
  readonly tellAgent: (
    agent: Id<"agt">,
    payload: JsonValue,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>;
}

// The report waits at least this long, so the DCA and copy orders' own runs tell it their skips.
const minWindowMs = 20_000;
// An order whose token no price reaches within this long after the resume is `no_fresh_price`.
const freshWaitMs = 120_000;
// A fill started on a fresh price has 30 seconds; the report waits a little past them.
const fillGraceMs = 35_000;
// How often the re-check looks whether every order has its outcome.
const lookEveryMs = 1_000;

// The price orders of the re-check: the others take their outcome from their rows.
function pricedOf(open: OpenCheck) {
  return [...open.orders.values()].filter(({ kind }) => hasPriceTrigger(kind));
}

function isSettled(open: OpenCheck): boolean {
  return pricedOf(open).every(
    ({ standing }) => standing.state !== "pending" && standing.state !== "firing",
  );
}

function isFiring(open: OpenCheck): boolean {
  return pricedOf(open).some(({ standing }) => standing.state === "firing");
}

// Whether the re-check may report now, timed from the latest resume it joined.
function mayReport(parts: DowntimeParts, open: OpenCheck): boolean {
  const sinceMs = parts.clock.now() - (parts.check.resumedAt() ?? open.sinceMs);
  if (sinceMs >= freshWaitMs + fillGraceMs) {
    return true;
  }
  return sinceMs >= freshWaitMs ? !isFiring(open) : sinceMs >= minWindowMs && isSettled(open);
}

async function untilReportable(parts: DowntimeParts, signal: AbortSignal): Promise<void> {
  for (;;) {
    const open = parts.check.open();
    if (open === undefined || mayReport(parts, open)) {
      return;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look a second, until every order has its outcome
    await parts.clock.sleep(lookEveryMs, signal);
  }
}

function closedEarly(): never {
  throw new BinferenceError({
    code: "engine.downtime_closed",
    message: "The downtime re-check closed before its report.",
  });
}

// The report of the open re-check, with the skip rows it holds, which it closes. A fault closes it
// and tells the held skips as usual; a stop leaves it open, so the engine marks no run and its next
// start reports the span again and tells the held skips then.
async function closedReport(
  parts: DowntimeParts,
  signal: AbortSignal,
): Promise<{ readonly report: DowntimeReport; readonly held: OpenCheck["held"] }> {
  const held = parts.check.open()?.held ?? new Map();
  try {
    await untilReportable(parts, signal);
    const open = parts.check.open() ?? closedEarly();
    const orders = await checkedOrdersOf({ orders: parts.orders, rows: paceRows }, open, signal);
    parts.check.close();
    const { cause, offFromMs, offMs } = open;
    return { report: { cause, offFromMs, offMs, orders }, held: open.held };
  } catch (error) {
    if (!signal.aborted) {
      const left = parts.check.open()?.held ?? held;
      parts.check.close();
      await announceRows(parts, [...left.values()], signal);
    }
    throw error;
  }
}

// Sends the report to the owner, when the re-check checked an order (the owner's choice, decision
// 0267), marks the skips it told, tells each agent whose orders it names, then marks the engine
// alive while no re-check is open: a stop before that leaves the earlier mark, so the next start
// reports the span again.
async function report(parts: DowntimeParts, signal: AbortSignal): Promise<DowntimeReport> {
  const { report: done, held } = await closedReport(parts, signal);
  const { orders } = done;
  if (orders.length > 0) {
    parts.publish(noticePush(resumedNotice(done)));
  }
  const ids = [...held.values()].map(({ id }) => id);
  if (ids.length > 0) {
    await parts.orders.markAnnounced({ ids, atMs: parts.clock.now() }, { signal });
  }
  const agents = [...new Set(orders.map(({ agentId }) => agentId))];
  for (const agent of agents) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one inbox write at a time
    await parts.tellAgent(agent, resumeReportPayload(done, agent), { signal });
  }
  if (parts.check.open() === undefined) {
    await parts.alive.markAlive(parts.clock.now(), { signal });
  }
  return done;
}

/** Creates the {@link Downtime} over the order store, the alive mark and the re-check's state. */
export function createDowntime(parts: DowntimeParts): Downtime {
  const running: { run?: DowntimeRun } = {};
  const resume = async (
    cause: "start" | Pause["cause"],
    span: { readonly fromMs: number; readonly offMs: number },
    signal: AbortSignal,
  ): Promise<DowntimeRun> => {
    // Before any await: the caller's next price is judged against this resume.
    const atMs = parts.clock.now();
    parts.check.fence(atMs);
    const read = allOrdersIn(parts.orders, ["active"], signal);
    parts.check.beginning(read.then(() => undefined));
    const orders = await read;
    const isOpen = parts.check.open() !== undefined;
    parts.check.begin({ cause, offFromMs: span.fromMs, offMs: span.offMs, atMs, orders });
    if (isOpen && running.run !== undefined) {
      return running.run;
    }
    const reported = report(parts, signal);
    const run: DowntimeRun = { reported };
    running.run = run;
    // Only this run's own end forgets it: a later resume may already run the next.
    const forget = (): void => {
      if (running.run === run) {
        delete running.run;
      }
    };
    void reported.then(forget, forget);
    return run;
  };
  return {
    async started({ signal }) {
      const lastMs = await parts.alive.lastAlive({ signal });
      const nowMs = parts.clock.now();
      if (lastMs === undefined) {
        await parts.alive.markAlive(nowMs, { signal });
        return undefined;
      }
      return resume("start", { fromMs: lastMs, offMs: Math.max(0, nowMs - lastMs) }, signal);
    },
    paused: async (pause, { signal }) => resume(pause.cause, pause, signal),
    async alive({ signal }) {
      if (parts.check.open() === undefined) {
        await parts.alive.markAlive(parts.clock.now(), { signal });
      }
    },
    findPausesWith(findPause) {
      parts.check.probe(findPause);
    },
  };
}
