/** A Chainlink feed that prices one asset in USD, and how fresh its answer must be. */
export interface PriceFeedDefinition {
  /** The feed's proxy, named among the same chain's `chainlink` contracts. */
  readonly contract: string;
  /** The asset the feed prices, as Chainlink names it. */
  readonly symbol: string;
  /** The decimals of the feed's answer. */
  readonly decimals: number;
  /** The longest time between two updates; an older answer is stale. */
  readonly heartbeatSeconds: number;
  /**
   * The feed watches a stablecoin, the registry token of its symbol, which counts as $1 while the
   * feed holds its peg (decision 0059).
   */
  readonly isStablecoin: boolean;
  /**
   * Registry tokens that wrap the feed's asset one for one, such as WBNB for BNB: each redeems for
   * exactly one unit of the asset, so the feed prices it as it prices the asset.
   */
  readonly wrappers?: readonly string[];
}
