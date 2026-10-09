import type { ReceiptReader } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  startExecutorBench,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });
const done = { states: ["reconciled"] } as const;
const coinPrice = { numerator: 600n, denominator: 10n ** 12n };

function noticesOf(pushes: readonly EnginePush[]): readonly string[] {
  return pushes.filter(({ kind }) => kind === "notice/new").map(({ data }) => JSON.stringify(data));
}

async function executionsOf(bench: ExecutorBench) {
  return bench.test.positions.executions({ isPaper: false, after: 0, limit: 10 }, live());
}

async function viewOf(bench: ExecutorBench, intent: Id<"int">) {
  return expectOk(await bench.test.engine.handlers["intent/get"](testCall({ intent })));
}

// An intent store that reads a finalized intent without its quote.
function withoutQuote(store: IntentStore): IntentStore {
  return {
    ...store,
    async get(id, options) {
      const record = await store.get(id, options);
      if (record?.state !== "finalized") {
        return record;
      }
      const { quote: _quote, ...rest } = record;
      return rest;
    },
  };
}

// A node whose first `failures` reads of what a transaction moved fail.
function failingTransfers(failures: number): (network: FakeNetwork) => ReceiptReader {
  return (network) => {
    let left = failures;
    return {
      head: async (chain, options) => network.head(chain, options),
      receipt: async (chain, hash, options) => network.receipt(chain, hash, options),
      nonceAt: async (account, block, options) => network.nonceAt(account, block, options),
      nativeReceived: async (account, block, options) =>
        network.nativeReceived(account, block, options),
      async transfers(chain, hash, options) {
        if (left > 0) {
          left -= 1;
          throw new Error("The node is down.");
        }
        return network.transfers(chain, hash, options);
      },
    };
  };
}

describe("reconciliation", () => {
  it("records the trade the chain shows, in the positions and with the move", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, done)).resolves.toBe("reconciled");
    const [transaction] = await transactionsOf(bench);
    const [execution] = await executionsOf(bench);
    expect(execution).toMatchObject({
      intentId: intent,
      isPaper: false,
      sold: { asset: testCoin, base: 1_000_000n },
      bought: { asset: testToken, base: 2_000_000n },
      gas: { asset: testCoin, base: 21_000n * 50_000_000n },
      txHash: transaction?.hash,
    });
    const view = await viewOf(bench, intent);
    expect(view.outcome).toStrictEqual({
      txHashes: [transaction?.hash],
      executions: [
        {
          amountIn: { asset: testCoin, base: 1_000_000n },
          amountOut: { asset: testToken, base: 2_000_000n },
          at: execution?.atMs,
        },
      ],
    });
    expect(noticesOf(bench.pushes)).toStrictEqual([]);
  });

  it("reconciles a trade more than 1% away from its simulation, with an alarm notice", async () => {
    const bench = await startExecutorBench({ fillOut: (base) => (base * 2n * 98n) / 100n });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, done)).resolves.toBe("reconciled");
    const [execution] = await executionsOf(bench);
    expect(execution?.bought.base).toBe(1_960_000n);
    expect(noticesOf(bench.pushes)).toStrictEqual([
      expect.stringContaining('"key":"notice.fillDiffers"'),
    ]);
    expect(eventsOf(bench)).toContain("executor.fill_differs:");
  });

  it("raises no alarm for a trade within 1% of its simulation", async () => {
    const bench = await startExecutorBench({ fillOut: (base) => (base * 2n * 995n) / 1_000n });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, done)).resolves.toBe("reconciled");
    expect(noticesOf(bench.pushes)).toStrictEqual([]);
  });

  it("counts the network fee of every step of a plan", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench, tokenSale);
    await expect(driveUntil(bench, intent, done)).resolves.toBe("reconciled");
    const [execution] = await executionsOf(bench);
    expect(execution).toMatchObject({
      sold: { asset: testToken, base: 1_000_000n },
      bought: { asset: testCoin, base: 2_000_000n },
      gas: { asset: testCoin, base: 2n * 21_000n * 50_000_000n },
    });
  });

  it("reads again on the next block while what a step moved cannot be read", async () => {
    const bench = await startExecutorBench({ receipts: failingTransfers(2) });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, done)).resolves.toBe("reconciled");
    expect(eventsOf(bench)).toContain("executor.read_failed:unexpected");
    expect(await executionsOf(bench)).toHaveLength(1);
  });

  it("leaves the intent finalized while the sold asset has no price", async () => {
    const prices = new Map([[testCoin, coinPrice]]);
    const bench = await startExecutorBench({ prices, limits: { settleAfterBlocks: 2 } });
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["included"] });
    prices.delete(testCoin);
    await expect(driveUntil(bench, intent, { ...done, blocks: 12 })).resolves.toBe("finalized");
    expect(eventsOf(bench)).toContain("executor.settle_waits:");
    expect(eventsOf(bench)).toContain("executor.settle_late:");
    expect(await executionsOf(bench)).toStrictEqual([]);
  });

  it("leaves the intent finalized while the network fee's coin has a zero price", async () => {
    const prices = new Map([[testCoin, coinPrice]]);
    const bench = await startExecutorBench({ prices, limits: { settleAfterBlocks: 1 } });
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["included"] });
    prices.set(testCoin, { numerator: 0n, denominator: 1n });
    await expect(driveUntil(bench, intent, { ...done, blocks: 12 })).resolves.toBe("finalized");
    expect(await executionsOf(bench)).toStrictEqual([]);
  });

  it("fails a finalized intent with no quote as a fault, and records nothing", async () => {
    const bench = await startExecutorBench({ intents: withoutQuote });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { ...done, blocks: 12 })).resolves.toBe("finalized");
    expect(eventsOf(bench)).toContain("executor.failed:engine.no_quote");
    expect(await executionsOf(bench)).toStrictEqual([]);
  });
});
