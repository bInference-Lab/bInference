/** How far a watcher's reads have come: the head seen, the block read, what it skipped and why. */
export interface ReadProgress {
  /** The newest block the block source saw. */
  head(): bigint | undefined;
  /** The newest block read. */
  read(): bigint | undefined;
  /** Blocks skipped since the start. */
  skipped(): bigint;
  /** The code of the last batch read that failed, until one succeeds. */
  fault(): string | undefined;
  /** The failover endpoint whose poll announced the head, when a poll did. */
  headEndpoint(): string | undefined;
  seeHead(head: bigint, endpoint?: string): void;
  /**
   * The block to read next: the one after the last read, or, more than `maxCatchUp` blocks
   * behind the head, the oldest of the newest `maxCatchUp`, counting the ones between as skipped.
   */
  nextBlock(head: bigint, maxCatchUp: bigint): bigint;
  /** Marks a block read, with no fault. */
  markRead(block: bigint): void;
  /** Marks the last batch as failed with its code. */
  markFailed(code: string): void;
}

/** Creates the {@link ReadProgress} of a watcher that has seen and read nothing. */
export function createReadProgress(): ReadProgress {
  let head: bigint | undefined;
  let read: bigint | undefined;
  let skipped = 0n;
  let fault: string | undefined;
  let announcedBy: string | undefined;
  return {
    head: () => head,
    read: () => read,
    skipped: () => skipped,
    fault: () => fault,
    headEndpoint: () => announcedBy,
    seeHead: (seen, endpoint) => {
      head = seen;
      announcedBy = endpoint;
    },
    nextBlock(newest, maxCatchUp) {
      const next = read === undefined ? newest : read + 1n;
      const oldest = newest - maxCatchUp + 1n;
      if (next >= oldest) {
        return next;
      }
      skipped += oldest - next;
      return oldest;
    },
    markRead: (block) => {
      read = block;
      fault = undefined;
    },
    markFailed: (code) => {
      fault = code;
    },
  };
}
