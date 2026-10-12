import type { Amount, AccountRef } from "@binference/chain";
import { bpsSchema, type Id } from "@binference/core";
import type { IntentRequest, QuoteView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { testAgent, testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import {
  driveUntil,
  type ExecutorBench,
  startExecutorBench,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });

const buy: IntentRequest = {
  kind: "buy",
  agent: testAgent,
  wallet: testWallet,
  reason: "Buy the token",
  token: testToken,
  spend: { asset: testCoin, base: 1_000_000n },
};

const halfSale: IntentRequest = {
  kind: "sell",
  agent: testAgent,
  wallet: testWallet,
  reason: "Sell half",
  token: testToken,
  amount: { percentBps: bpsSchema.parse(5_000) },
};

async function quoteOf(bench: ExecutorBench, intent: Id<"int">): Promise<QuoteView> {
  const record = await bench.test.stores.intents.get(intent, live());
  return quoteDocument.decode(record?.quote ?? null);
}

describe("a live buy and sell in the wallet queue", () => {
  it("reconciles a live buy in the pools as it does a swap", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench, buy);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
  });

  it("runs a sale by share at the amount its quote fixed, though the holding moved after the tap", async () => {
    const held = new Map<AccountRef, readonly Amount[]>([
      [testAccount, [{ asset: testToken, base: 3_000_001n }]],
    ]);
    const bench = await startExecutorBench({ hold: true, engine: { held } });
    const intent = await tapped(bench, halfSale);
    // The wallet's holding halves before the queue takes the sale; the tap confirmed 1,500,000.
    held.set(testAccount, [{ asset: testToken, base: 1_500_000n }]);
    await bench.release();
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const quote = await quoteOf(bench, intent);
    expect(quote.amountIn).toStrictEqual({ asset: testToken, base: 1_500_000n });
    const transactions = await transactionsOf(bench);
    expect(transactions.map((transaction) => transaction.state)).toStrictEqual(["final", "final"]);
  });
});
