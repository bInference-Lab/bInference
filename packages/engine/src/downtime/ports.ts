/**
 * Keeps when the engine last ran: a mark the engine writes about once a minute while it serves,
 * and once more as it stops, which its next start reads to tell how long it was off (decision
 * 0266). Adapters: a SQLite store in `@binference/store`, and an in-memory fake.
 */
export interface AliveStore {
  /** The last mark, in epoch milliseconds, or `undefined` before the engine ever marked one. */
  lastAlive(options: { readonly signal: AbortSignal }): Promise<number | undefined>;
  /**
   * Keeps `atMs` as the last mark in place of the one before, even an earlier one: a wall clock
   * set back counts from its new time.
   */
  markAlive(atMs: number, options: { readonly signal: AbortSignal }): Promise<void>;
}
