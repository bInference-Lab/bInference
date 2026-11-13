import type { Clock, Id, JsonValue } from "@binference/core";
import type { StreamingHttp } from "../providers/ports.js";
import type { ListedAnswer } from "./listed-mcp-answers.js";
import { argumentsRefusal } from "./listed-mcp-arguments.js";
import {
  type ConnectionFailure,
  type ListedConnection,
  openListedConnection,
  type ToolOffReason,
} from "./listed-mcp-connection.js";
import { createListedRests, type ListedRests } from "./listed-mcp-rests.js";
import type { ListedMcpState } from "./listed-mcp-state.schema.js";
import type { ListedMcpTool, McpListing } from "./listing.schema.js";

/** Why a listed tool's call got no answer from its server (decision 0428). */
type ListedCallFailure =
  | {
      readonly kind: "failed";
      readonly reason: ConnectionFailure["reason"] | "revoked" | "listing_changed";
    }
  | { readonly kind: "failed"; readonly reason: "resting"; readonly seconds: number }
  | { readonly kind: "failed"; readonly reason: "tool_off"; readonly off: ToolOffReason };

/** What a listed tool's call answers: the server's answer, or why there is none. */
export type ListedCallOutcome = ListedAnswer | ListedCallFailure;

/** What an agent's connections are opened with. */
export interface ListedEntryParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
  /** This build's release, which the client names itself with. */
  readonly version: string;
}

/** One agent's dealings with one listing at one version. */
export interface ListedEntry {
  readonly listing: McpListing;
  /** Calls a tool of the listing; answers at once, sending nothing, when it must not run. */
  call(tool: ListedMcpTool, args: JsonValue, signal: AbortSignal): Promise<ListedCallOutcome>;
  states(): readonly ListedMcpState[];
  /** Lets the connection go, ending its session. */
  close(): Promise<void>;
}

/** The calls of one agent to one listing that may run at once. */
const maxCallsAtOnce = 4;
/** How long a connection stays open without a call. */
export const idleCloseMs: number = 5 * 60_000;

type Opened = ListedConnection | ConnectionFailure;

function isConnection(value: Opened): value is ListedConnection {
  return "call" in value;
}

/**
 * One try at a connection, which the calls that meet it share: its failure counts once, and it is
 * let go only once the last call on it ended.
 */
interface Attempt {
  readonly opening: Promise<Opened>;
  /** True the first time only: a try's failure counts once, however many calls met it. */
  claimFailure(): boolean;
  /** A call runs on it. */
  join(): void;
  /** A call on it ended; a retired try closes once none is left. */
  leave(): void;
  /** No new call takes it; it closes once its last call ends. */
  retire(): void;
  /** Closes it now, its calls in flight too. */
  close(): Promise<void>;
}

function attemptOf(parts: ListedEntryParts, listing: McpListing): Attempt {
  const stop = new AbortController();
  const opening = openListedConnection({ ...parts, listing }, stop.signal);
  const life = { users: 0, isRetired: false, isCounted: false, isClosed: false };
  const close = async (): Promise<void> => {
    if (life.isClosed) {
      return;
    }
    life.isClosed = true;
    stop.abort();
    const open = await opening;
    if (isConnection(open)) {
      await open.close();
    }
  };
  return {
    opening,
    claimFailure() {
      const isFirst = !life.isCounted;
      life.isCounted = true;
      return isFirst;
    },
    join() {
      life.users += 1;
    },
    leave() {
      life.users -= 1;
      if (life.isRetired && life.users === 0) {
        void close();
      }
    },
    retire() {
      life.isRetired = true;
      if (life.users === 0) {
        void close();
      }
    },
    close,
  };
}

/** The one connection an entry holds: opened at the first call, let go after a failure or idling. */
interface ConnectionHolder {
  /** The try the next call runs on, made when none is; the call leaves it when it ends. */
  take(): Attempt;
  /** Lets a try go: no new call takes it, and it closes once its last call ends. */
  retire(attempt: Attempt): void;
  /** Starts the idle wait after the last call ends; a new call stops it. */
  idleLater(): void;
  stopIdle(): void;
  /** Closes the current try now, its calls in flight too. */
  closeNow(): Promise<void>;
}

function connectionHolder(parts: ListedEntryParts, listing: McpListing): ConnectionHolder {
  let current: Attempt | undefined;
  let idle: AbortController | undefined;
  const retire = (attempt: Attempt): void => {
    current = current === attempt ? undefined : current;
    attempt.retire();
  };
  return {
    take() {
      current ??= attemptOf(parts, listing);
      current.join();
      return current;
    },
    retire,
    idleLater() {
      idle = new AbortController();
      parts.clock.sleep(idleCloseMs, idle.signal).then(
        () => current !== undefined && retire(current),
        () => undefined,
      );
    },
    stopIdle: () => idle?.abort(),
    async closeNow() {
      const held = current;
      current = undefined;
      await held?.close();
    },
  };
}

// The opening, or none once the call's own signal ended the wait: the opening goes on for the
// calls that share it.
async function openedFor(attempt: Attempt, signal: AbortSignal): Promise<Opened | undefined> {
  if (signal.aborted) {
    return undefined;
  }
  const waited = new AbortController();
  const stopped = new Promise<undefined>((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), {
      once: true,
      signal: waited.signal,
    });
  });
  try {
    return await Promise.race([attempt.opening, stopped]);
  } finally {
    waited.abort();
  }
}

// Why a call must not run: a tool the live list turned off, arguments too long or holding a
// secret, a listing that rests, or a fifth call at once. None sends anything.
function refusalOf(
  checks: {
    readonly off: ReadonlyMap<string, ToolOffReason>;
    readonly busy: number;
    readonly rests: ListedRests;
  },
  tool: ListedMcpTool,
  args: JsonValue,
): ListedCallFailure | undefined {
  const off = checks.off.get(tool.server);
  if (off !== undefined) {
    return { kind: "failed", reason: "tool_off", off };
  }
  if (argumentsRefusal(args) !== undefined) {
    return { kind: "failed", reason: "refused" };
  }
  const seconds = checks.rests.restingSeconds();
  if (seconds !== undefined) {
    return { kind: "failed", reason: "resting", seconds };
  }
  return checks.busy >= maxCallsAtOnce ? { kind: "failed", reason: "busy" } : undefined;
}

function statesOf(
  agent: Id<"agt">,
  listing: McpListing,
  checks: { readonly off: ReadonlyMap<string, ToolOffReason>; readonly rests: ListedRests },
): readonly ListedMcpState[] {
  const id = listing.listing;
  const resting: ListedMcpState[] =
    checks.rests.restingSeconds() === undefined
      ? []
      : [{ agent, listing: id, state: "resting", reason: checks.rests.lastReason() }];
  const off = listing.tools.flatMap((tool): ListedMcpState[] => {
    const reason = checks.off.get(tool.server);
    return reason === undefined
      ? []
      : [{ agent, listing: id, state: "off", reason, tool: tool.as }];
  });
  return [...resting, ...off];
}

// What a call runs on: the entry's connection, its rests and the tools its live list turned off.
interface EntryState {
  readonly holder: ConnectionHolder;
  readonly rests: ListedRests;
  readonly off: Map<string, ToolOffReason>;
}

const stoppedByCaller: ListedCallFailure = { kind: "failed", reason: "timed_out" };

// A failure the server caused: it counts once toward a rest, and the connection is let go.
function failedWith(
  state: EntryState,
  attempt: Attempt,
  failure: ConnectionFailure,
): ListedCallFailure {
  state.rests.failed(failure);
  state.holder.retire(attempt);
  return { kind: "failed", reason: failure.reason };
}

// The connection's own failure, which counts once however many calls met it.
function openFailed(
  state: EntryState,
  attempt: Attempt,
  failure: ConnectionFailure,
): ListedCallFailure {
  if (!attempt.claimFailure()) {
    return { kind: "failed", reason: failure.reason };
  }
  return failedWith(state, attempt, failure);
}

// Calls on an open connection: a failure the call's own signal ended counts nothing, a good answer
// ends any rest.
async function callOn(
  state: EntryState,
  run: { readonly attempt: Attempt; readonly open: ListedConnection; readonly tool: ListedMcpTool },
  request: { readonly args: JsonValue; readonly signal: AbortSignal },
): Promise<ListedCallOutcome> {
  const outcome = await run.open.call(run.tool, request.args, request.signal);
  const isAnswer = "kind" in outcome && outcome.kind === "answer";
  if (!isAnswer && request.signal.aborted) {
    return stoppedByCaller;
  }
  if (!("kind" in outcome)) {
    return failedWith(state, run.attempt, outcome);
  }
  if (outcome.kind === "bad_answer") {
    return failedWith(state, run.attempt, { reason: "bad_answer" });
  }
  state.rests.answered();
  return outcome;
}

// Opens the connection when none is, takes the tools its live list turned off, and calls.
async function runCall(
  state: EntryState,
  tool: ListedMcpTool,
  request: { readonly args: JsonValue; readonly signal: AbortSignal },
): Promise<ListedCallOutcome> {
  const attempt = state.holder.take();
  try {
    const open = await openedFor(attempt, request.signal);
    if (open === undefined) {
      return stoppedByCaller;
    }
    if (!isConnection(open)) {
      return openFailed(state, attempt, open);
    }
    for (const [name, reason] of open.off) {
      state.off.set(name, reason);
    }
    const turnedOff = state.off.get(tool.server);
    if (turnedOff !== undefined) {
      return { kind: "failed", reason: "tool_off", off: turnedOff };
    }
    return await callOn(state, { attempt, open, tool }, request);
  } finally {
    attempt.leave();
  }
}

/**
 * Creates one agent's {@link ListedEntry} for a listing at its version (decisions 0428 and 0430):
 * one connection, opened at the first call and let go after a failure or 5 minutes without a call,
 * never under a call in flight; the tools its live list turned off stay off for this version;
 * three failures in a row the server caused rest it, one for each try at a connection and each
 * request, and a good answer ends the rest. A call its own signal ended counts nothing.
 */
export function createListedEntry(
  parts: ListedEntryParts,
  agent: Id<"agt">,
  listing: McpListing,
): ListedEntry {
  const state: EntryState = {
    holder: connectionHolder(parts, listing),
    rests: createListedRests(parts.clock),
    off: new Map(),
  };
  let busy = 0;
  return {
    listing,
    async call(tool, args, signal) {
      const refused = refusalOf({ off: state.off, busy, rests: state.rests }, tool, args);
      if (refused !== undefined) {
        return refused;
      }
      busy += 1;
      state.holder.stopIdle();
      try {
        return await runCall(state, tool, { args, signal });
      } finally {
        busy -= 1;
        if (busy === 0) {
          state.holder.idleLater();
        }
      }
    },
    states: () => statesOf(agent, listing, state),
    close: async () => {
      state.holder.stopIdle();
      await state.holder.closeNow();
    },
  };
}
