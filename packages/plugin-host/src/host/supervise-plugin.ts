import { type Clock, err, type JsonValue, type Logger, type Result } from "@binference/core";
import type { CallFailure, RunningPlugin } from "./open-plugin.js";
import type { PluginEnd } from "./plugin-channel.js";

/** The first wait before a crashed plugin starts again, and the longest (decision 0300). */
const restartDelays = { firstMs: 1_000, longestMs: 300_000 } as const;
/** After this many crashes inside {@link crashWindowMs}, the host turns the plugin off. */
const crashesToTurnOff = 5;
/** The window crashes are counted in. */
const crashWindowMs = 600_000;

/**
 * Why the host turned a plugin off: 5 crashes in 10 minutes, or an end no restart mends, its
 * manifest refused or its installed files not the ones its pin names.
 */
export type TurnedOff = "crashes" | "bad_manifest" | "links" | "files_changed";

// The ends a restart cannot mend: the same files would end the same way.
const finalEnds: ReadonlySet<PluginEnd> = new Set(["bad_manifest", "links", "files_changed"]);

function isFinal(end: PluginEnd): end is Exclude<TurnedOff, "crashes"> {
  return finalEnds.has(end);
}

/** A plugin the host keeps running. */
export interface SupervisedPlugin {
  /** Calls one of its tools while it runs; `not_running` while it waits to start again or is off. */
  call(
    tool: string,
    input: JsonValue,
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure>>;
  /** Settles once its first start is ready or failed. */
  readonly firstStart: Promise<void>;
  /** Settles once the host turned it off, with why, or once it was stopped. */
  readonly done: Promise<TurnedOff | "stopped">;
}

const ignore = (): void => undefined;

/** What the supervisor runs a plugin with. */
export interface SuperviseParts {
  readonly plugin: string;
  /** Starts the plugin's process and waits for it to be ready. */
  open(signal: AbortSignal): Promise<Result<RunningPlugin, PluginEnd>>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Hears that the host turned the plugin off, and why. */
  onTurnedOff(reason: TurnedOff): void;
  /** Hears why each run ended, a stop aside. */
  onEnded(end: PluginEnd): void;
}

// What the supervisor remembers between runs: the times of recent crashes, and how many crashed
// in a row since the last calm run.
interface Crashes {
  readonly at: readonly number[];
  readonly inRow: number;
}

// The wait before the next start: 1 second, doubling with each crash in a row, up to 5 minutes.
function delayAfter(inRow: number): number {
  return Math.min(restartDelays.firstMs * 2 ** (inRow - 1), restartDelays.longestMs);
}

function afterCrash(
  crashes: Crashes,
  run: { readonly startedAt: number; readonly now: number },
): Crashes {
  const calm = run.now - run.startedAt >= crashWindowMs;
  const at = [...crashes.at, run.now].filter((time) => run.now - time < crashWindowMs);
  return { at, inRow: calm ? 1 : crashes.inRow + 1 };
}

/**
 * Keeps one community plugin running (decision 0300): a process that ends for any reason but a
 * stop starts again after 1 second, the wait doubling up to 5 minutes, and back to 1 second once
 * a run lasted 10 minutes. The 5th crash within 10 minutes turns it off: `onTurnedOff` hears it
 * and `done` settles `crashes`. An end no restart mends, a refused manifest or installed files
 * that are not the pinned ones, turns it off at once with that reason. The signal stops it.
 */
export function supervisePlugin(parts: SuperviseParts, signal: AbortSignal): SupervisedPlugin {
  let current: RunningPlugin | undefined;
  let settleFirst: () => void = ignore;
  const firstStart = new Promise<void>((resolve) => {
    settleFirst = resolve;
  });
  const runOnce = async (): Promise<PluginEnd> => {
    const opened = await parts.open(signal).catch(() => err("exited" as const));
    settleFirst();
    if (!opened.ok) {
      return opened.error;
    }
    current = opened.value;
    const end = await opened.value.ended;
    current = undefined;
    return end;
  };
  const run = async (crashes: Crashes): Promise<TurnedOff | "stopped"> => {
    const startedAt = parts.clock.now();
    const end = await runOnce();
    if (signal.aborted) {
      return "stopped";
    }
    parts.logger.warn("plugin.crashed", { sourceId: parts.plugin, errorCode: end });
    if (isFinal(end)) {
      parts.onTurnedOff(end);
      return end;
    }
    parts.onEnded(end);
    const next = afterCrash(crashes, { startedAt, now: parts.clock.now() });
    if (next.at.length >= crashesToTurnOff) {
      parts.onTurnedOff("crashes");
      return "crashes";
    }
    await parts.clock.sleep(delayAfter(next.inRow), signal).catch(() => undefined);
    return signal.aborted ? "stopped" : run(next);
  };
  return {
    call: async (tool, input, callSignal) =>
      current === undefined ? err("not_running") : current.call(tool, input, callSignal),
    firstStart,
    done: run({ at: [], inRow: 0 }),
  };
}
