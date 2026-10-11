import { type Clock, err, type JsonValue, ok, type Result } from "@binference/core";
import {
  type OperationName,
  type ProtocolErrorCode,
  protocolErrorCodes,
} from "@binference/protocol";
import type { RouteLine, RouteOrigin, RouteReplyLine } from "@binference/runtime";

/** One routed operation, its args as the operation's schema encodes them. */
export interface RouteRequest {
  readonly op: OperationName;
  readonly args: JsonValue;
  readonly origin: RouteOrigin;
}

/** What a routed call ends with: the runtime's result, or the error code the call fails with. */
export type RouteOutcome = Result<JsonValue, ProtocolErrorCode>;

/** The routed calls of one runtime start: sent on its `route` lines, answered by its replies. */
export interface RouteCalls {
  /**
   * Sends the call once a place is free: 8 run at once and 64 wait, and one more fails
   * `protocol.busy`. It fails `engine.timeout` with no reply within 10 seconds of being sent, and
   * `runtime.unavailable` when the runtime stops first.
   */
  send(request: RouteRequest, signal: AbortSignal): Promise<RouteOutcome>;
  /** Hands a reply to the call it answers; a reply to no running call is ignored. */
  answer(reply: RouteReplyLine): void;
  /** The runtime stopped: every call running or waiting fails `runtime.unavailable`. */
  failAll(): void;
}

/** What the routed calls write to and time with. */
export interface RouteCallsOptions {
  /** Writes one `route` line to the runtime. */
  readonly write: (line: RouteLine) => Promise<void>;
  readonly clock: Clock;
}

/** Routed calls at once, and calls waiting for a place (runtime spec, section 9). */
export const routeLimits = { running: 8, waiting: 64, replyTimeoutMs: 10_000 } as const;

type Settle = (outcome: RouteOutcome) => void;

const knownCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

function isKnownCode(code: string): code is ProtocolErrorCode {
  return knownCodes.has(code);
}

// The reply's result, or the code it refused the call with; a code the protocol lacks is a fault.
function outcomeOf(reply: RouteReplyLine): RouteOutcome {
  if ("result" in reply) {
    return ok(reply.result);
  }
  const { code } = reply.error;
  return isKnownCode(code) ? err(code) : err("internal.error");
}

// Writes one route line and waits for its reply, at most 10 seconds. A line that cannot be written
// means the runtime is gone.
async function sendOne(
  sending: { readonly options: RouteCallsOptions; readonly running: Map<string, Settle> },
  line: RouteLine,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const timeout = new AbortController();
  const replied = new Promise<RouteOutcome>((resolve) => sending.running.set(line.id, resolve));
  const timedOut = sending.options.clock
    .sleep(routeLimits.replyTimeoutMs, AbortSignal.any([timeout.signal, signal]))
    .then(
      (): RouteOutcome => err("engine.timeout"),
      (): RouteOutcome => err("engine.timeout"),
    );
  try {
    await sending.options.write(line);
    return await Promise.race([replied, timedOut]);
  } catch {
    return err(signal.aborted ? "engine.timeout" : "runtime.unavailable");
  } finally {
    timeout.abort();
  }
}

/** Creates the routed calls of one runtime start. */
export function createRouteCalls(options: RouteCallsOptions): RouteCalls {
  const running = new Map<string, Settle>();
  const waiting: (() => void)[] = [];
  const state = { next: 0, isGone: false };
  const release = (id: string): void => {
    running.delete(id);
    waiting.shift()?.();
  };
  const run = async (request: RouteRequest, signal: AbortSignal): Promise<RouteOutcome> => {
    state.next += 1;
    const id = `r${String(state.next)}`;
    try {
      return await sendOne({ options, running }, { t: "route", id, ...request }, signal);
    } finally {
      release(id);
    }
  };
  return {
    async send(request, signal) {
      if (state.isGone) {
        return err("runtime.unavailable");
      }
      if (running.size < routeLimits.running) {
        return run(request, signal);
      }
      if (waiting.length >= routeLimits.waiting) {
        return err("protocol.busy");
      }
      const place = await new Promise<boolean>((resolve) => {
        waiting.push(() => resolve(!state.isGone));
      });
      return place ? run(request, signal) : err("runtime.unavailable");
    },
    answer(reply) {
      running.get(reply.id)?.(outcomeOf(reply));
    },
    failAll() {
      state.isGone = true;
      running.forEach((settle) => settle(err("runtime.unavailable")));
      waiting.splice(0).forEach((admit) => admit());
    },
  };
}
