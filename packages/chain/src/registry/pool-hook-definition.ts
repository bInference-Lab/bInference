/**
 * A pool hook that routes on a chain may pass through, and the fee it takes. The hook is a
 * contract of the same chain's registry entry, named by its venue and its name there.
 */
export interface PoolHookDefinition {
  /** The venue whose contracts the registry lists the hook among, such as a launchpad's id. */
  readonly venue: string;
  /** The hook's name among that venue's contracts. */
  readonly contract: string;
  /**
   * The share of every swap through its pools the hook keeps, in integer basis points, as read
   * on chain on the day its registry entry was read.
   */
  readonly feeBps: number;
  /** Who made the hooked pools, as a card names them, such as Genius.fun (decision 0215). */
  readonly maker: string;
}
