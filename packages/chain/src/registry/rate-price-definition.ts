/**
 * A token that redeems for a growing amount of its chain's coin, such as a liquid staking token,
 * priced at the coin's price times what its own contract converts one whole token to (decision
 * 0328). The contract is one of the same chain's registry entry, named by its venue and its name
 * there, and it answers `paused()`: while it is paused, the token has no price. A Chainlink feed
 * of the same rate guards it: with the feed stale, unread or too far from the contract, the token
 * has no price either.
 */
export interface RatePriceDefinition {
  /** The token, a registry token of the same chain. */
  readonly symbol: string;
  /** The venue whose contracts the registry lists the converting contract among. */
  readonly venue: string;
  /** The converting contract's name among that venue's contracts. */
  readonly contract: string;
  /**
   * The contract's view function that takes an amount of the token in its base units and
   * answers what it redeems for in the coin's base units: `name(uint256) returns (uint256)`.
   */
  readonly convertFunction: string;
  /**
   * The least coin one whole token may convert to, in integer basis points of one whole coin. A
   * rate below it is no price: a low price would let a cap pass more than it should.
   */
  readonly minRateBps: number;
  /** The most coin one whole token may convert to, in integer basis points of one whole coin. */
  readonly maxRateBps: number;
  /** The Chainlink feed of the same rate that the contract's rate is checked against. */
  readonly checkFeed: {
    /** The feed's proxy, named among the same chain's `chainlink` contracts. */
    readonly contract: string;
    /** The decimals of the feed's answer, the coin one whole token converts to. */
    readonly decimals: number;
    /** The longest time between two updates; an answer older than it and 30 s is stale. */
    readonly heartbeatSeconds: number;
    /** The most the contract's rate may differ from the feed's answer, in basis points of it. */
    readonly maxGapBps: number;
  };
}
