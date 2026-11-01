/** A wallet's credit shares with a validator, and the validator's pool at one block. */
export interface CreditPool {
  /** The wallet's shares. */
  readonly balance: bigint;
  /** Every share of the validator's credit contract. */
  readonly supply: bigint;
  /** The coin the pool holds, which every share is worth a part of. */
  readonly pooled: bigint;
}

/** What an unstake burns, and the coin those shares take out. */
export interface UnstakeShares {
  readonly shares: bigint;
  readonly moved: bigint;
}

/**
 * What shares are worth in coin, as StakeCredit prices them: rounded down. The pool holds some
 * shares and some coin.
 */
export function coinOfShares(shares: bigint, pool: Pick<CreditPool, "supply" | "pooled">): bigint {
  return (shares * pool.pooled) / pool.supply;
}

/**
 * The shares a stake of the amount mints, as StakeCredit mints them: rounded down. The pool holds
 * some shares and some coin.
 */
export function sharesOfCoin(amount: bigint, pool: Pick<CreditPool, "supply" | "pooled">): bigint {
  return (amount * pool.supply) / pool.pooled;
}

/**
 * The shares an unstake burns: for `whole`, every share the wallet holds; for an amount, the fewest
 * shares worth at least it, rounded up, and every share when the amount is the stake's whole worth,
 * so no dust remains. An amount above the stake's worth is `exceeds_staked`. The pool holds some
 * shares and some coin, and the wallet some shares.
 */
export function unstakeShares(
  amount: bigint | "whole",
  pool: CreditPool,
): UnstakeShares | "exceeds_staked" {
  const worth = coinOfShares(pool.balance, pool);
  if (amount === "whole" || amount === worth) {
    return { shares: pool.balance, moved: worth };
  }
  if (amount > worth) {
    return "exceeds_staked";
  }
  const shares = (amount * pool.supply + pool.pooled - 1n) / pool.pooled;
  return { shares, moved: coinOfShares(shares, pool) };
}
