import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testCoin, testWallet } from "../intents/test-intents.js";
import { fillsOn, holding } from "./test-paper-fills.js";

const live = { signal: new AbortController().signal };
const paperQuery = { walletId: testWallet, isPaper: true };

// What a fill leaves: filled with the input taken while the portfolio covers it, else ended with
// the portfolio as it was.
function expectedOf(coinBase: bigint, amountInBase: bigint) {
  return coinBase >= amountInBase
    ? { state: "paper_filled", coinLeft: coinBase - amountInBase }
    : { state: "failed_check", coinLeft: coinBase };
}

async function coinHeld(held: Awaited<ReturnType<typeof holding>>): Promise<bigint> {
  const positions = await held.positions.positions(paperQuery, live);
  return positions.find((row) => row.asset === testCoin)?.quantityBase ?? 0n;
}

describe("paper fill invariants", () => {
  it("fill a sale or swap only while the portfolio holds its whole input, and never sell more than it holds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: 10n ** 19n }),
        fc.bigInt({ min: 1n, max: 10n ** 19n }),
        async (coinBase, amountInBase) => {
          const held = await holding({ state: "confirmed", coinBase, amountInBase });
          const after = await fillsOn(held).fillAtQuote(held.snapshot, live);
          const coinLeft = await coinHeld(held);
          expect({ state: after.record.state, coinLeft }).toStrictEqual(
            expectedOf(coinBase, amountInBase),
          );
          expect(coinLeft).toBeGreaterThanOrEqual(0n);
        },
      ),
      { numRuns: 60 },
    );
  });
});
