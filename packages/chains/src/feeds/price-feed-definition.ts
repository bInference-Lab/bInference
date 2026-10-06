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
}
