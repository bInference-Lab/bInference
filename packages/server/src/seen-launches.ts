/** The Mini App launches that signed in, so the same `initData` never signs in twice. */
export interface SeenLaunches {
  /**
   * Keeps the launch's hash and answers `true`, or answers `false` when the hash signed in within
   * the retention already.
   */
  claim(hash: string, nowMs: number): boolean;
}

/** How many launches the store keeps, and for how long. */
export interface SeenLaunchesOptions {
  readonly retentionMs: number;
  readonly maxEntries: number;
}

/**
 * Creates the replay store of Mini App launches, in memory. A hash stays for `retentionMs`; when
 * `maxEntries` are kept, the oldest goes first. Only launches that passed every other check are
 * kept, so filling the store takes as many fresh launches by the owner, and a launch that leaves
 * early is past its `auth_date` window long before then.
 */
export function createSeenLaunches(options: SeenLaunchesOptions): SeenLaunches {
  const seen = new Map<string, number>();
  const forgetOld = (nowMs: number): void => {
    for (const [hash, atMs] of seen) {
      if (nowMs - atMs < options.retentionMs && seen.size < options.maxEntries) {
        return;
      }
      seen.delete(hash);
    }
  };
  return {
    claim(hash, nowMs) {
      const atMs = seen.get(hash);
      if (atMs !== undefined && nowMs - atMs < options.retentionMs) {
        return false;
      }
      seen.delete(hash);
      forgetOld(nowMs);
      seen.set(hash, nowMs);
      return true;
    },
  };
}
