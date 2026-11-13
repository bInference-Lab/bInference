/** The runtime's word that it took the settings in force, by the number each settings line carries. */
export interface SettingsAcks {
  /** Numbers the settings put in force now: the next settings line carries it. */
  next(): number;
  /** The number of the settings in force now, which a start line carries too. */
  latest(): number;
  /** The runtime took the settings up to `seq`: by its `ready` to a start, or its answer to a line. */
  took(seq: number): void;
  /** Settles once the runtime took the settings in force now. */
  taken(): Promise<void>;
  /** Settles every wait, as the runtime stops for good. */
  release(): void;
}

interface Waiter {
  readonly seq: number;
  readonly resolve: () => void;
}

/** Creates the {@link SettingsAcks} of one supervisor, the start line's settings numbered 1. */
export function createSettingsAcks(): SettingsAcks {
  let latest = 1;
  let taken = 0;
  let waiters: Waiter[] = [];
  return {
    next() {
      latest += 1;
      return latest;
    },
    latest: () => latest,
    took(seq) {
      taken = Math.max(taken, seq);
      const ready = waiters.filter((waiter) => waiter.seq <= taken);
      waiters = waiters.filter((waiter) => waiter.seq > taken);
      ready.forEach((waiter) => waiter.resolve());
    },
    async taken() {
      const seq = latest;
      return seq <= taken
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ seq, resolve }));
    },
    release() {
      const all = waiters;
      waiters = [];
      all.forEach((waiter) => waiter.resolve());
    },
  };
}
