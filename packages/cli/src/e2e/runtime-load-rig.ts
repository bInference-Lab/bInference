import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";

// The rig of the agent runtime's link under load (decision 0442): the engine, the runtime and the
// model share one manual clock, which only `drive` moves, and only while every call the runtime
// has in flight waits on that clock in a slow handler of the test's.

/** Rings each time the run moves: a call of the runtime settled, a push came, a wait began or ended. */
export interface Bell {
  ring(): void;
  /** How many times it rang so far. */
  rings(): number;
  /** Resolves once it rang more than `count` times. */
  after(count: number): Promise<void>;
}

/** Creates a {@link Bell} that has not rung. */
export function createBell(): Bell {
  const state = { rang: 0 };
  const waiting: { readonly count: number; readonly resolve: () => void }[] = [];
  return {
    ring() {
      state.rang += 1;
      const due = waiting.filter((wait) => state.rang > wait.count);
      due.forEach((wait) => waiting.splice(waiting.indexOf(wait), 1));
      due.forEach((wait) => wait.resolve());
    },
    rings: () => state.rang,
    after: async (count) =>
      new Promise((resolve) => {
        if (state.rang > count) {
          resolve();
          return;
        }
        waiting.push({ count, resolve });
      }),
  };
}

/** The waits on the shared clock: a model's pace and the engine's slow handlers. */
export interface Timeline {
  /** Waits `delayMs` on the clock; `op` names the runtime's call a handler holds up meanwhile. */
  wait(delayMs: number, signal: AbortSignal, op?: string): Promise<void>;
  /** Holds the runtime's call `op` until its signal aborts, as an engine that never answers it. */
  hold(op: string, signal: AbortSignal): Promise<void>;
  /** When the next wait ends, if any wait ends on its own. */
  nextDueMs(): number | undefined;
  /** How many handlers hold up a call `op` now. */
  holding(op: string): number;
}

interface Waiting {
  readonly dueMs?: number;
  readonly op?: string;
}

/** Creates the run's {@link Timeline}, which rings the bell as each wait begins and ends. */
export function createTimeline(clock: ManualClock, bell: Bell): Timeline {
  const waits = new Set<Waiting>();
  const during = async (waiting: Waiting, until: Promise<void>): Promise<void> => {
    waits.add(waiting);
    bell.ring();
    try {
      await until;
    } finally {
      waits.delete(waiting);
      bell.ring();
    }
  };
  return {
    wait: async (delayMs, signal, op) =>
      during(
        { dueMs: clock.now() + delayMs, ...(op === undefined ? {} : { op }) },
        clock.sleep(delayMs, signal),
      ),
    hold: async (op, signal) =>
      during(
        { op },
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      ),
    nextDueMs: () => {
      const dues = [...waits].flatMap((each) => each.dueMs ?? []);
      return dues.length === 0 ? undefined : Math.min(...dues);
    },
    holding: (op) => [...waits].filter((each) => each.op === op).length,
  };
}

/** What the runtime's calls on its link did. */
export interface LinkWatch {
  /** Each call the engine or the client refused for want of room, as `<op> <code>`. */
  readonly refused: string[];
  /** The keys of the usage records the engine took. */
  readonly charged: Set<string>;
  /** The helpers' reports the engine took. */
  readonly reports: string[];
  /** When each `turn/end` the engine took was answered, on the shared clock. */
  readonly endsAtMs: number[];
  /** The runtime's calls in flight now, by operation. */
  readonly inFlight: Map<string, number>;
  /** Resolves once the runtime listed its inbox, which it does as it starts. */
  readonly listed: Promise<void>;
  /** The runtime's client, which counts each call while it waits. */
  watch(client: ProtocolClient): ProtocolClient;
}

const busyCodes: ReadonlySet<string> = new Set(["protocol.busy", "client.busy"]);

type Watched = Omit<LinkWatch, "watch"> & { readonly onListed: () => void };

// Notes what an answered call did: a usage record taken, a report heard, a listing.
function noteAnswer(watched: Watched, call: { readonly op: string; readonly key?: string }): void {
  if (call.op === "usage/record" && call.key !== undefined) {
    watched.charged.add(call.key);
  }
  if (call.op === "helper/ended") {
    watched.reports.push(call.op);
  }
  if (call.op === "inbox/list") {
    watched.onListed();
  }
}

function callOf(
  client: ProtocolClient,
  watch: { readonly watched: Watched; readonly clock: ManualClock; readonly bell: Bell },
): ProtocolClient["call"] {
  const { watched, clock, bell } = watch;
  const { inFlight } = watched;
  return async (op, args, options) => {
    inFlight.set(op, (inFlight.get(op) ?? 0) + 1);
    try {
      const result = await client.call(op, args, options);
      noteAnswer(watched, { op, ...(options.key === undefined ? {} : { key: options.key }) });
      if (op === "turn/end") {
        watched.endsAtMs.push(clock.now());
      }
      return result;
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : "unexpected";
      if (busyCodes.has(code)) {
        watched.refused.push(`${op} ${code}`);
      }
      throw error;
    } finally {
      inFlight.set(op, (inFlight.get(op) ?? 1) - 1);
      bell.ring();
    }
  };
}

/** Creates a {@link LinkWatch} that rings the bell as each call settles. */
export function watchLink(clock: ManualClock, bell: Bell): LinkWatch {
  const listing = { resolve: (): void => undefined };
  const watched: Watched = {
    refused: [],
    charged: new Set(),
    reports: [],
    endsAtMs: [],
    inFlight: new Map(),
    listed: new Promise<void>((resolve) => {
      listing.resolve = resolve;
    }),
    onListed: () => listing.resolve(),
  };
  return {
    ...watched,
    watch: (client) => ({ ...client, call: callOf(client, { watched, clock, bell }) }),
  };
}

/** What `drive` moves and reads. */
export interface Run {
  readonly clock: ManualClock;
  readonly bell: Bell;
  readonly timeline: Timeline;
  readonly link: LinkWatch;
  /** Lets the event loop read the sockets, with no timer: a call that crosses them. */
  readonly crossSockets: () => Promise<void>;
  readonly isOver: () => boolean;
}

// While nothing waits on the timeline, time moves in steps this long, the sockets read before each.
const idleStepMs = 250;

// Every call of the runtime in flight waits in a slow handler: nothing moves until time does.
function isQuiet(run: Run): boolean {
  return [...run.link.inFlight].every(([op, count]) => count <= run.timeline.holding(op));
}

// The runtime waits on timers of its own alone: once the sockets carried what it sent last, time
// moves one step.
async function idleStep(run: Run): Promise<void> {
  await run.crossSockets();
  if (isQuiet(run) && run.timeline.nextDueMs() === undefined) {
    await run.clock.advance(idleStepMs);
  }
}

// No move of time is longer, so the sockets carry the server's pings and their answers.
const longestJumpMs = 5_000;

async function step(run: Run): Promise<void> {
  const { clock, bell, timeline } = run;
  const dueMs = timeline.nextDueMs();
  if (dueMs === undefined) {
    await idleStep(run);
    return;
  }
  const leftMs = Math.max(0, dueMs - clock.now());
  if (leftMs > longestJumpMs) {
    await clock.advance(longestJumpMs);
    await run.crossSockets();
    return;
  }
  const seen = bell.rings();
  await clock.advance(leftMs);
  await bell.after(seen);
}

/**
 * Moves the shared clock until the run is over: to the next wait's end once every call the
 * runtime has in flight waits on the clock, and otherwise not until a call settles.
 */
export async function drive(run: Run): Promise<void> {
  while (!run.isOver()) {
    const seen = run.bell.rings();
    // oxlint-disable-next-line eslint/no-await-in-loop -- each move of time follows the run
    await (isQuiet(run) ? step(run) : run.bell.after(seen));
  }
}
