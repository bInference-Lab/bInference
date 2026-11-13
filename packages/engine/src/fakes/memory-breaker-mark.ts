import { err, ok, type Result } from "@binference/core";
import type { InstallFacts } from "../install/install-record.js";
import type { BreakerWrite } from "../intents/freeze-write.js";

/**
 * The install's breaker mark in memory (decision 0440), which the in-memory intent store writes
 * inside its freeze, as the SQLite store writes `safety.breaker_at` and the columns beside it.
 */
export interface MemoryBreakerMark {
  /** When the breaker took hold of the install, or `undefined` while it does not. */
  at(): number | undefined;
  /**
   * A pull or a lift is `stale` unless the install still holds the version its plan read and its
   * own version is above it.
   */
  check(write: BreakerWrite): Result<void, "stale">;
  /** Writes a checked pull, keeping an earlier time, or a lift, at `atMs`. */
  write(write: BreakerWrite, atMs: number): void;
  /** Marks `version` told; `stale` unless it is the version applied and not told yet. */
  tell(version: number): Result<void, "stale">;
  /** The install facts the mark gives: none before the first version. */
  facts(): Pick<
    InstallFacts,
    "breakerAtMs" | "breakerVersion" | "breakerToldVersion" | "breakerPulledAtMs"
  >;
}

interface Mark {
  readonly atMs?: number;
  readonly pulledAtMs?: number;
  readonly version: number;
  readonly told: number;
}

// The mark after a checked write: a pull that takes hold takes the row's time, or its own, and a
// pull that holds already keeps both; a lift clears the hold and keeps the row's time.
function written(mark: Mark, write: BreakerWrite, atMs: number): Mark {
  const { atMs: _held, ...rest } = mark;
  const moved = { ...rest, version: write.version, told: write.isTold ? write.version : mark.told };
  if (!write.isPulled) {
    return moved;
  }
  return mark.atMs === undefined
    ? { ...moved, atMs, pulledAtMs: write.changedAtMs ?? atMs }
    : { ...moved, atMs: mark.atMs };
}

/** Creates a {@link MemoryBreakerMark} the breaker never moved. */
export function createMemoryBreakerMark(): MemoryBreakerMark {
  const held: { mark: Mark } = { mark: { version: 0, told: 0 } };
  return {
    at: () => held.mark.atMs,
    check: (write) =>
      write.fromVersion === held.mark.version && write.version > held.mark.version
        ? ok(undefined)
        : err("stale"),
    write: (write, atMs) => {
      held.mark = written(held.mark, write, atMs);
    },
    tell: (version) => {
      if (version !== held.mark.version || held.mark.told >= version) {
        return err("stale");
      }
      held.mark = { ...held.mark, told: version };
      return ok(undefined);
    },
    facts: () => {
      const { atMs, pulledAtMs, version, told } = held.mark;
      return {
        ...(atMs === undefined ? {} : { breakerAtMs: atMs }),
        ...(version === 0 ? {} : { breakerVersion: version }),
        ...(told === 0 ? {} : { breakerToldVersion: told }),
        ...(pulledAtMs === undefined ? {} : { breakerPulledAtMs: pulledAtMs }),
      };
    },
  };
}
