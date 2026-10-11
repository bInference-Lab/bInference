/** One token whose approvals a wallet's ceiling caps, and the least dollars a whole one counts. */
export interface CeilingCapToken {
  /** The token's symbol in the same chain's registry entry. */
  readonly symbol: string;
  /** The least one whole token is counted at when a cap is sized from dollars, in micro-dollars. */
  readonly floorUsd: bigint;
}

/**
 * What a wallet's ceiling caps on one chain per rolling 24 hours (decision 0149): the native coin
 * every transaction sends, and the approvals of each token listed. Caps are sized from a dollar
 * limit at each floor, so a lower price than the floor only makes a cap tighter in dollars.
 */
export interface CeilingCapsDefinition {
  /** The least one whole native coin is counted at, in micro-dollars. */
  readonly nativeFloorUsd: bigint;
  readonly tokens: readonly CeilingCapToken[];
}
