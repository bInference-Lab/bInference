import type { Clock } from "@binference/core";
import type { AuthLockout, AuthLockoutReport } from "@binference/engine/access";

/** A key the failure count keeps, with what its lockout locks. */
export interface CountedKey {
  readonly key: string;
  readonly lockout: AuthLockout;
}

/** How often a lockout of one key is reported. */
export interface LockoutAlertLimits {
  /** How long after a reported lockout of a key the next lockout of it goes unreported. */
  readonly authAlertEveryMs: number;
  readonly authLockoutMs: number;
  /** The most keys remembered at once; past it, the key reported longest ago is forgotten. */
  readonly maxAuthKeys: number;
}

/** Hears the lockouts the failures of a sign-in or pairing set. */
export interface LockoutAlerts {
  /** Reports each key this failure locked out, unless one of it was reported lately. */
  locked(keys: readonly CountedKey[], lockedKeys: readonly string[]): void;
}

/**
 * Creates the lockout reports of a server: one report per lockout, never per failure, and at most
 * one per key within `authAlertEveryMs`, so a guesser that keeps failing makes one notice a
 * quarter of an hour, not one per lockout. Without `report` nothing is reported.
 */
export function createLockoutAlerts(
  options: LockoutAlertLimits & {
    readonly clock: Clock;
    readonly report?: (lockout: AuthLockoutReport) => void;
  },
): LockoutAlerts {
  const reportedAtMs = new Map<string, number>();
  const shouldReport = (key: string, nowMs: number): boolean => {
    const last = reportedAtMs.get(key);
    if (last !== undefined && nowMs - last < options.authAlertEveryMs) {
      return false;
    }
    reportedAtMs.delete(key);
    reportedAtMs.set(key, nowMs);
    const [oldest] = reportedAtMs.keys();
    if (reportedAtMs.size > options.maxAuthKeys && oldest !== undefined) {
      reportedAtMs.delete(oldest);
    }
    return true;
  };
  return {
    locked(keys, lockedKeys) {
      const { report } = options;
      if (report === undefined || lockedKeys.length === 0) {
        return;
      }
      const nowMs = options.clock.now();
      const untilMs = nowMs + options.authLockoutMs;
      keys
        .filter((item) => lockedKeys.includes(item.key) && shouldReport(item.key, nowMs))
        .forEach((item) => report({ ...item.lockout, untilMs }));
    },
  };
}

/**
 * The counted key of a connection's or request's source: `ipc` is the local socket, and an
 * address a proxy on this machine passed on (`forwarded:<address>`) is named by that address.
 */
export function sourceKey(source: string): CountedKey {
  const key = `source:${source}`;
  if (source === "ipc") {
    return { key, lockout: { kind: "local" } };
  }
  const address = source.startsWith("forwarded:") ? source.slice("forwarded:".length) : source;
  return { key, lockout: { kind: "address", address } };
}
