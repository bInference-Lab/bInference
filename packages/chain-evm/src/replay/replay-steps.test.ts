import { describe, expect, it } from "vitest";
import type { PathBlock, PoolPath, PricePath } from "./price-path.js";
import { replaySteps } from "./replay-steps.js";

const address = "0x0000000000000000000000000000000000000001";

function block(offset: bigint, reserveQuote: bigint): PathBlock {
  return { offset, reserveToken: 10_000n, reserveQuote, price: "0.000000000000000000" };
}

function pool(blocks: readonly PathBlock[]): PoolPath {
  const decimals = { tokenDecimals: 18, quoteDecimals: 18 };
  return { symbol: "T", token: address, quote: address, pair: address, ...decimals, blocks };
}

function pathOf(pools: readonly PoolPath[]): PricePath {
  return { day: "2026-10-12", firstBlock: 0n, lastBlock: 100n, minMoveBps: 1, pools };
}

describe("replaySteps", () => {
  it("replays a block once its pool moved the step from its last replayed price", () => {
    const steps = replaySteps(
      pathOf([
        pool([block(0n, 10_000n), block(3n, 10_005n), block(9n, 10_010n), block(12n, 10_015n)]),
      ]),
      10,
    );

    expect(steps).toStrictEqual([
      {
        offset: 9n,
        moves: [{ pool: 0, scale: { numerator: 100_100_000n, denominator: 100_000_000n } }],
      },
    ]);
  });

  it("moves every pool a recorded block moved in one replayed block", () => {
    const steps = replaySteps(
      pathOf([
        pool([block(0n, 10_000n), block(5n, 9_900n)]),
        pool([block(0n, 20_000n), block(5n, 20_400n), block(7n, 20_000n)]),
      ]),
      50,
    );

    expect(
      steps.map(({ offset, moves }) => [offset, moves.map((move) => move.pool)]),
    ).toStrictEqual([
      [5n, [0, 1]],
      [7n, [1]],
    ]);
  });

  it("starts each pool at its first recorded price", () => {
    expect(replaySteps(pathOf([pool([block(4n, 10_000n)])]), 1)).toStrictEqual([]);
  });
});
