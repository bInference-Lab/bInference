import { BinferenceError, type Clock, type Id, type Logger } from "@binference/core";
import type { RunningTurns } from "@binference/engine/chat";
import type { NodeProgram } from "@binference/platform";
import {
  type EngineLine,
  engineLineSchema,
  readControlLines,
  runtimeLineSchema,
  type RuntimeSettings,
  type StartLine,
} from "@binference/runtime";
import { restartDelayMs, stableUptimeMs } from "./restart-delay.js";
import {
  createRouteCalls,
  type RouteCalls,
  type RouteOutcome,
  type RouteRequest,
} from "./route-calls.js";
import type { RuntimeToken } from "./runtime-token.js";
import type { StartRuntime } from "./start-runtime.js";

/** The `runtime` health signal: `ok` after `ready`, else `fail` since the runtime went down. */
export interface RuntimeHealth {
  readonly state: "ok" | "fail";
  /** When it went down, or when the engine first started it. */
  readonly since: number;
}

/** The engine's hold on the agent runtime process (runtime spec, section 2). */
export interface RuntimeSupervisor {
  /** Starts the runtime, and starts it again each time it exits, until `stop`. */
  begin(): void;
  /** Routes a call to the runtime; fails `runtime.unavailable` while it is down or starting. */
  route(request: RouteRequest, signal: AbortSignal): Promise<RouteOutcome>;
  health(): RuntimeHealth;
  /**
   * Puts new settings in force: the running runtime gets them as a `settings` line once its start
   * line is out, applied from its next turn, and every later start begins with them.
   */
  apply(settings: RuntimeSettings): Promise<void>;
  /**
   * Tells the runtime to stop and waits for its exit, at most 10 seconds, then ends it; ends it at
   * once when the signal aborts. No start follows.
   */
  stop(signal: AbortSignal): Promise<void>;
}

/** What the supervisor starts the runtime with. */
export interface RuntimeSupervisorOptions {
  readonly start: StartRuntime;
  /** Makes the token of one start, revoking the earlier ones. */
  readonly makeToken: (signal: AbortSignal) => Promise<RuntimeToken>;
  /** The start line but its token: the IPC address, the paths and the settings. */
  readonly startLine: Omit<StartLine, "t" | "token">;
  readonly turns: Pick<RunningTurns, "startRuntime" | "clearAll">;
  /** Ends the connections still signed in with tokens a new start revoked. */
  readonly onRevoked: (tokens: readonly Id<"tok">[]) => void;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** How long a start may take to write `ready`, and how long `stop` waits for the exit. */
export const runtimeTimeouts = { readyMs: 30_000, stopMs: 10_000 } as const;

interface Life {
  readonly program: NodeProgram;
  readonly routes: RouteCalls;
  readonly write: (line: EngineLine) => Promise<void>;
  /** Settles once the start line is written, or failed to be. */
  readonly opened: Promise<void>;
}

/** The settings each start begins with: the start line's, then each that `apply` put in force. */
interface SettingsNow {
  current: RuntimeSettings;
}

/** The runtime's state across its starts; only its own methods change it. */
interface Tracker {
  readonly current: () => Life | undefined;
  readonly began: (life: Life) => void;
  readonly isReady: (life: Life) => boolean;
  /** The runtime wrote `ready`; a second `ready` changes nothing. */
  readonly ready: (life: Life) => void;
  /** The runtime exited; answers how long it was up after `ready`. */
  readonly exited: (exit: {
    readonly code: number | undefined;
    readonly isStop: boolean;
  }) => number;
  /** The wait before the next start after an exit, counting the exits that follow one another. */
  readonly delayAfter: (upMs: number) => number;
  readonly health: () => RuntimeHealth;
  /** The settings the next start begins with. */
  readonly settings: SettingsNow;
}

const ignore = (): void => undefined;

function createTracker(
  options: Pick<RuntimeSupervisorOptions, "clock" | "logger" | "startLine">,
): Tracker {
  const { clock, logger } = options;
  const state: { life?: Life; readyAtMs?: number } = {};
  const counts = { failures: 0, hasExited: false, downSince: clock.now() };
  return {
    current: () => state.life,
    began(life) {
      state.life = life;
      delete state.readyAtMs;
    },
    isReady: (life) => state.life === life && state.readyAtMs !== undefined,
    ready(life) {
      if (state.life === life && state.readyAtMs === undefined) {
        state.readyAtMs = clock.now();
        // The first `ready` is routine; one after an exit ends a gap the owner may ask about.
        const level = counts.hasExited ? "info" : "debug";
        logger[level]("runtime.ready", { durationMs: clock.now() - counts.downSince });
      }
    },
    exited({ code, isStop }) {
      const upMs = state.readyAtMs === undefined ? 0 : clock.now() - state.readyAtMs;
      if (state.readyAtMs !== undefined) {
        counts.downSince = clock.now();
      }
      delete state.life;
      delete state.readyAtMs;
      counts.hasExited = true;
      const errorCode = code === undefined ? "runtime.ended" : `runtime.exit_${String(code)}`;
      // An exit the shutdown asked for is part of it, not news.
      logger[isStop ? "debug" : "warn"]("runtime.exited", { errorCode, durationMs: upMs });
      return upMs;
    },
    delayAfter(upMs) {
      counts.failures = upMs >= stableUptimeMs ? 0 : counts.failures;
      const delayMs = restartDelayMs(counts.failures);
      counts.failures += 1;
      return delayMs;
    },
    health: () =>
      state.readyAtMs === undefined
        ? { state: "fail", since: counts.downSince }
        : { state: "ok", since: state.readyAtMs },
    settings: { current: options.startLine.settings },
  };
}

// Reads the runtime's lines until its output ends. A line it cannot read ends it: the runtime
// checks every line it writes, so such a line means it is broken.
async function readOutput(life: Life, tracker: Tracker, logger: Logger): Promise<void> {
  try {
    for await (const text of readControlLines(life.program.output)) {
      const line = runtimeLineSchema.safeParse(JSON.parse(text));
      if (!line.success) {
        throw new BinferenceError({
          code: "runtime.bad_line",
          message: "The runtime wrote a bad line.",
        });
      }
      if (line.data.t === "ready") {
        tracker.ready(life);
      } else if (line.data.t === "routeReply") {
        life.routes.answer(line.data);
      }
    }
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "runtime.bad_line";
    logger.error("runtime.bad_output", { errorCode });
    life.program.kill();
  }
}

// Ends a start that wrote no `ready` within its time; it then counts as an exit.
async function endIfNotReady(
  options: RuntimeSupervisorOptions,
  started: { readonly life: Life; readonly tracker: Tracker },
  signal: AbortSignal,
): Promise<void> {
  try {
    await options.clock.sleep(runtimeTimeouts.readyMs, signal);
  } catch {
    return;
  }
  if (!started.tracker.isReady(started.life)) {
    options.logger.error("runtime.not_ready");
    started.life.program.kill();
  }
}

// One start: a new token, the process and its start line, then its exit. Answers how long it
// stayed up after `ready`.
async function live(options: RuntimeSupervisorOptions, tracker: Tracker, stop: AbortSignal) {
  const token = await options.makeToken(stop);
  options.onRevoked(token.revoked);
  options.turns.startRuntime(token.id);
  const program = await options.start(new AbortController().signal);
  if (stop.aborted) {
    // The shutdown began while the process started: it has done nothing yet.
    program.kill();
    await program.exited;
    return 0;
  }
  const write = async (line: EngineLine): Promise<void> =>
    program.write(`${JSON.stringify(engineLineSchema.encode(line))}\n`);
  const start = { t: "start", token: token.token, ...options.startLine } as const;
  const opening = write({ ...start, settings: tracker.settings.current }).catch(() => {
    program.kill();
  });
  const routes = createRouteCalls({ write, clock: options.clock });
  const life: Life = { program, write, routes, opened: opening };
  tracker.began(life);
  const reading = readOutput(life, tracker, options.logger);
  const waiting = new AbortController();
  void endIfNotReady(options, { life, tracker }, waiting.signal);
  await opening;
  const code = await program.exited;
  waiting.abort();
  await reading;
  life.routes.failAll();
  options.turns.clearAll();
  return tracker.exited({ code, isStop: stop.aborted });
}

// One start, or the reason it failed in the log; a failed start was up for no time.
async function liveOrLog(options: RuntimeSupervisorOptions, tracker: Tracker, stop: AbortSignal) {
  try {
    return await live(options, tracker, stop);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    // A start the shutdown cut short failed for no fault of its own.
    options.logger[stop.aborted ? "debug" : "error"]("runtime.start_failed", { errorCode });
    return 0;
  }
}

// One start and the wait after it. The next start is scheduled, never awaited, so the starts never
// chain up however long the engine serves.
async function generation(
  options: RuntimeSupervisorOptions,
  tracker: Tracker,
  loop: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = loop;
  const upMs = await liveOrLog(options, tracker, stop);
  if (stop.aborted) {
    return;
  }
  const delayMs = tracker.delayAfter(upMs);
  if (delayMs > 0) {
    options.logger.info("runtime.restart_waits", { durationMs: delayMs });
    await options.clock.sleep(delayMs, stop).catch(ignore);
  }
  if (!stop.aborted) {
    loop.next();
  }
}

// Writes `stop`, then waits for the exit at most 10 seconds, or until the shutdown's own signal.
async function stopLife(life: Life, options: RuntimeSupervisorOptions, signal: AbortSignal) {
  const waited = new AbortController();
  const ended = AbortSignal.any([waited.signal, signal]);
  if (ended.aborted) {
    life.program.kill();
  }
  ended.addEventListener("abort", () => life.program.kill(), { once: true });
  await life.write({ t: "stop" }).catch(() => life.program.kill());
  void endAfterStopTime(life, options, ended);
  await life.program.exited;
  waited.abort();
}

async function endAfterStopTime(
  life: Life,
  options: RuntimeSupervisorOptions,
  signal: AbortSignal,
) {
  try {
    await options.clock.sleep(runtimeTimeouts.stopMs, signal);
  } catch {
    return;
  }
  options.logger.warn("runtime.stop_timeout");
  life.program.kill();
}

/**
 * Creates the supervisor of the agent runtime. `begin` starts the runtime at once and each time it
 * exits, after a wait that grows with the exits that follow one another: none, then 2, 4, 8, 16,
 * 32 and 60 seconds, then 60; a runtime that stayed up 10 minutes resets it. Each start makes a
 * new token and revokes the one before; a start that writes no `ready` within 30 seconds is ended
 * and counts as an exit. While the runtime is down, its turns end and every routed call fails
 * `runtime.unavailable`.
 */
export function createRuntimeSupervisor(options: RuntimeSupervisorOptions): RuntimeSupervisor {
  const stopping = new AbortController();
  const tracker = createTracker(options);
  const loop = { running: Promise.resolve() };
  const next = (): void => {
    loop.running = generation(options, tracker, { stop: stopping.signal, next });
  };
  return {
    begin: next,
    async route(request, signal) {
      const life = tracker.current();
      return life === undefined || !tracker.isReady(life)
        ? { ok: false, error: "runtime.unavailable" }
        : life.routes.send(request, signal);
    },
    health: () => tracker.health(),
    async apply(settings) {
      tracker.settings.current = settings;
      const life = tracker.current();
      if (life !== undefined) {
        await life.opened;
        // A runtime that went down meanwhile starts again with these settings.
        await life.write({ t: "settings", settings }).catch(ignore);
      }
    },
    async stop(signal) {
      stopping.abort();
      const life = tracker.current();
      if (life !== undefined) {
        await stopLife(life, options, signal);
      }
      // A start still under way ends itself once it sees the stop; the shutdown waits no longer
      // than its own time for that.
      const outOfTime = new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await Promise.race([loop.running, outOfTime]);
    },
  };
}
