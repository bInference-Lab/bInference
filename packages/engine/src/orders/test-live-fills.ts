import type { AccountRef, Amount, RelaySender } from "@binference/chain";
import type { Id, JsonValue } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import {
  type BenchOptions,
  type ExecutorBench,
  flush,
  startExecutorBench,
} from "../executor/test-executor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import type { OrderFills } from "./fill-orders.js";
import type { OrderRecord } from "./order-record.js";
import { eightyCents, fillPrices } from "./test-fills.js";
import { createdOrder, storedOrder, tapCard, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** A live limit buy of the test token with the coin, once, while the token is at or below $1. */
export const limitBuy: OrderRequest = {
  ...testStopLoss(),
  kind: "limit",
  side: "buy",
  spend: testCoin,
  size: { base: 10n ** 15n },
  trigger: { price: 1_000_000n, direction: "below" },
  maxFills: 1,
};

/** A bench whose live engine fills live orders, its agent's wallet stored as setup stores it. */
export async function startLiveFills(
  options: {
    readonly intents?: (store: IntentStore) => IntentStore;
    readonly hold?: boolean;
    readonly held?: ReadonlyMap<AccountRef, readonly Amount[]>;
    readonly sender?: (sender: RelaySender) => RelaySender;
    readonly limits?: NonNullable<BenchOptions["limits"]>;
    /** Wraps the intent store the executor reads and writes through, not the engine's. */
    readonly executorIntents?: (store: IntentStore) => IntentStore;
    /** Whether the executor signs live fills; on unless told off. */
    readonly executorFills?: boolean;
    /** Wraps what the executor reads receipts, transfers and nonces through. */
    readonly receipts?: NonNullable<BenchOptions["receipts"]>;
    /** The USD prices; the coin at $600 and the test token at $0.80 when absent. */
    readonly prices?: typeof fillPrices;
  } = {},
): Promise<ExecutorBench> {
  const { held, intents, executorFills = true, executorIntents, prices, ...rest } = options;
  const engine = {
    liveOrderFills: true,
    prices: prices ?? fillPrices,
    ...(held === undefined ? {} : { held }),
    ...(intents === undefined ? {} : { intents }),
  };
  const wrapped = executorIntents === undefined ? {} : { intents: executorIntents };
  const bench = await startExecutorBench({
    ...rest,
    ...wrapped,
    engine,
    liveOrderFills: executorFills,
  });
  bench.test.stores.install.addWallet(
    testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
  );
  return bench;
}

/** An order the CLI made and the owner confirmed on its card. */
export async function activeOrderOf(
  bench: ExecutorBench,
  request: OrderRequest = limitBuy,
): Promise<OrderRecord> {
  const created = await createdOrder(bench.test, request);
  await tapCard(bench.test, created.intent, "confirm");
  return storedOrder(bench.test, created.order);
}

/** Fills the order at the test token's $0.80 and lets the executor's work run. */
export async function fillOnce(
  bench: ExecutorBench,
  order: Id<"ord">,
): Promise<Awaited<ReturnType<OrderFills["run"]>>> {
  const outcome = await bench.test.engine.fillOrder({ order, price: eightyCents }, live);
  await flush();
  return outcome;
}

/** The buys or sales the engine proposed for orders, live, in any state. */
export async function liveFillsOf(
  bench: ExecutorBench,
  kind: "buy" | "sell" = "buy",
): Promise<readonly IntentRecord[]> {
  const all = await bench.test.stores.intents.list(
    {
      states: [
        "confirmed",
        "executing",
        "included",
        "finalized",
        "reconciled",
        "expired",
        "cancelled",
        "failed_check",
        "failed_onchain",
      ],
      limit: 50,
    },
    live,
  );
  return all.filter(
    (record) => record.kind === kind && record.proposer === "engine" && !record.isPaper,
  );
}

/** The notices the executor sent, oldest first. */
export function executorNotices(bench: ExecutorBench): readonly JsonValue[] {
  return bench.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
}
