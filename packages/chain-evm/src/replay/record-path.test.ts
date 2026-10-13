import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { pathPrice, recordedBlocks, syncReserves, syncTopic } from "./record-path.js";

const whole = 10n ** 18n;
const shape = {
  firstBlock: 1_000n,
  isToken0: true,
  tokenDecimals: 18,
  quoteDecimals: 18,
  minMoveBps: 1,
};

// One Sync log: its block, its index in the block and the pair's two reserves after it.
function sync([block, logIndex, reserve0, reserve1]: readonly [bigint, bigint, bigint, bigint]) {
  return { block, logIndex, reserve0, reserve1 };
}

describe("syncReserves", () => {
  it("reads both reserves of a Sync log", () => {
    const data = encodeAbiParameters(
      [{ type: "uint112" }, { type: "uint112" }],
      [5n * whole, 7n * whole],
    );

    expect(syncReserves({ topics: [syncTopic], data })).toStrictEqual({
      reserve0: 5n * whole,
      reserve1: 7n * whole,
    });
  });

  it("names the Sync event by its topic", () => {
    expect(syncTopic).toBe("0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1");
  });
});

describe("pathPrice", () => {
  it("prices a whole token in whole quote, cut to 18 places", () => {
    const price = pathPrice(
      { reserveToken: 3n * 10n ** 8n, reserveQuote: 10n * whole },
      { tokenDecimals: 8, quoteDecimals: 18 },
    );

    expect(price).toBe("3.333333333333333333");
  });
});

describe("recordedBlocks", () => {
  it("keeps each block's last sync, as the token and its quote", () => {
    const blocks = recordedBlocks(
      [sync([1_002n, 9n, 100n * whole, 2n * whole]), sync([1_002n, 4n, 100n * whole, 1n * whole])],
      { ...shape, isToken0: false },
    );

    expect(blocks).toStrictEqual([
      {
        offset: 2n,
        reserveToken: 2n * whole,
        reserveQuote: 100n * whole,
        price: "50.000000000000000000",
      },
    ]);
  });

  it("leaves out a block that moved the price less than the least move", () => {
    const blocks = recordedBlocks(
      [
        sync([1_000n, 0n, 10_000n, 10_000n]),
        sync([1_001n, 0n, 10_000n, 10_001n]),
        sync([1_002n, 0n, 10_000n, 10_002n]),
        sync([1_003n, 0n, 10_000n, 10_002n]),
      ],
      { ...shape, minMoveBps: 2 },
    );

    expect(blocks.map(({ offset }) => offset)).toStrictEqual([0n, 2n, 3n]);
  });

  it("leaves out a sync with an empty side", () => {
    const blocks = recordedBlocks(
      [sync([1_000n, 0n, 0n, 10n]), sync([1_001n, 0n, 5n, 10n])],
      shape,
    );

    expect(blocks.map(({ offset }) => offset)).toStrictEqual([1n]);
  });
});
