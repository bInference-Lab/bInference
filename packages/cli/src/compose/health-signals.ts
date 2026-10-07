import { monitorEventLoopDelay } from "node:perf_hooks";
import type { ResultOf } from "@binference/protocol";

/** One health signal of `engine/status`. */
export type HealthSignal = ResultOf<"engine/status">["health"][number];

/** What the engine's health signals read. */
export interface HealthProbe {
  /** The signals now: event-loop lag since the last read, memory, and each missing part. */
  read(): readonly HealthSignal[];
  /** Stops measuring the event loop. */
  stop(): void;
}

/** What the probe reports besides what it measures itself. */
export interface HealthProbeOptions {
  /** Parts with no adapter yet, each reported as failed. */
  readonly missing: readonly string[];
  /** Whether the log file lost lines since the engine started. */
  readonly logFailed: () => boolean;
}

type SignalState = HealthSignal["state"];

const lagWarnMs = 100;
const lagFailMs = 1_000;
// The engine aims to idle under 300 MB; past 1 GB a 1 GB machine is out of room.
const memoryWarnBytes = 300 * 1024 * 1024;
const memoryFailBytes = 1024 * 1024 * 1024;

/** The state of an event-loop lag: ok under 100 ms, warn under a second, else failed. */
export function lagState(lagMs: number): SignalState {
  if (lagMs < lagWarnMs) {
    return "ok";
  }
  return lagMs < lagFailMs ? "warn" : "fail";
}

/** The state of the resident memory: ok under 300 MB, warn under 1 GB, else failed. */
export function memoryState(residentBytes: number): SignalState {
  if (residentBytes < memoryWarnBytes) {
    return "ok";
  }
  return residentBytes < memoryFailBytes ? "warn" : "fail";
}

const nanosPerMs = 1_000_000;

/**
 * Starts measuring the event loop's delay. Each read reports the 99th percentile of the delay
 * since the read before, the resident memory, the log file, and every missing part as failed.
 */
export function startHealthProbe(options: HealthProbeOptions): HealthProbe {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  return {
    read() {
      const lagMs = delay.count === 0 ? 0 : delay.percentile(99) / nanosPerMs;
      delay.reset();
      return [
        { signal: "event_loop", state: lagState(lagMs) },
        { signal: "memory", state: memoryState(process.memoryUsage().rss) },
        { signal: "logs", state: options.logFailed() ? "warn" : "ok" },
        ...options.missing.map((part): HealthSignal => ({ signal: part, state: "fail" })),
      ];
    },
    stop: () => delay.disable(),
  };
}
