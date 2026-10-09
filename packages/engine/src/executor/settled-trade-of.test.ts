import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import type { QuoteView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { hashOf } from "../contracts/transaction-store-fixtures.js";
import { testCoin, testToken } from "../intents/test-intents.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { differsFromSimulation, type SettledStep, settledTradeOf } from "./settled-trade-of.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const other = assetRefSchema.parse("fake:1/token:0x0000000d");
const holder = { wallet, family: createFakeFamily() };
const quote = {
  amountIn: { asset: testCoin, base: 100n },
  expectedOut: { asset: testToken, base: 200n },
  gas: { asset: testCoin, base: 1n },
} as QuoteView;

function step(n: number, transfers: SettledStep["transfers"], hasReceipt = true): SettledStep {
  const transaction = {
    id: fixtureId("tx", n),
    hash: hashOf(n),
    ...(hasReceipt
      ? {
          receipt: {
            hash: hashOf(n),
            block: { number: 5n, hash: "blk5" },
            status: "success",
            gasUsed: 10n,
            feePerGasBase: 3n,
          },
        }
      : {}),
  } as TransactionRecord;
  return { transaction, transfers };
}

const swapped = [
  { from: wallet, to: router, amount: { asset: testCoin, base: 100n } },
  { from: router, to: wallet, amount: { asset: testToken, base: 199n } },
];

describe("settledTradeOf", () => {
  it("nets what the steps moved for the wallet, and adds up the fee of every step", () => {
    const trade = settledTradeOf([step(1, []), step(2, swapped)], { quote, holder, atMs: 7 });
    expect(trade).toStrictEqual({
      amountIn: { asset: testCoin, base: 100n },
      amountOut: { asset: testToken, base: 199n },
      gas: { asset: testCoin, base: 60n },
      txHashes: [hashOf(1), hashOf(2)],
      atMs: 7,
    });
  });

  it("counts a net change the other way as nothing, and a step without a receipt as no fee", () => {
    const backwards = [
      { from: router, to: wallet, amount: { asset: testCoin, base: 5n } },
      { from: wallet, to: router, amount: { asset: testToken, base: 5n } },
    ];
    const trade = settledTradeOf([step(1, backwards, false)], { quote, holder, atMs: 7 });
    expect(trade).toMatchObject({
      amountIn: { base: 0n },
      amountOut: { base: 0n },
      gas: { base: 0n },
    });
  });
});

describe("differsFromSimulation", () => {
  const simulation = { spent: [quote.amountIn], received: [quote.expectedOut], simulatedAt: 1 };
  const trade = settledTradeOf([step(1, swapped)], { quote, holder, atMs: 7 });

  it("holds a trade within 1% of its simulation, either way", () => {
    expect(differsFromSimulation(trade, simulation)).toBe(false);
    const above = { ...trade, amountOut: { asset: testToken, base: 202n } };
    expect(differsFromSimulation(above, simulation)).toBe(false);
  });

  it("flags a trade more than 1% away, on either side, or in an asset the simulation never named", () => {
    const low = { ...trade, amountOut: { asset: testToken, base: 197n } };
    const more = { ...trade, amountIn: { asset: testCoin, base: 102n } };
    const elsewhere = { ...trade, amountOut: { asset: other, base: 200n } };
    expect(differsFromSimulation(low, simulation)).toBe(true);
    expect(differsFromSimulation(more, simulation)).toBe(true);
    expect(differsFromSimulation(elsewhere, simulation)).toBe(true);
  });
});
