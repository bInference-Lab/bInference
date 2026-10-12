import type { AssetRef, UsdPrice } from "@binference/chain";
import type { Id, JsonValue } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import type { IntentRecord } from "../intents/intent-record.js";
import { testCoin, testToken } from "../intents/test-intents.js";
import type { TestEngine, TestEngineOptions } from "../operations/test-engine.js";
import type { FillPrice } from "./fill-orders.js";
import type { OrderFillRecord } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";
import { createdOrder, startOrderEngine, storedOrder, tapCard } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** One whole test token, which has 6 decimals. */
export const wholeToken = 1_000_000n;

/** The test token at $0.80, 0.8 micro-dollars a base unit, as a trigger reads it. */
export const eightyCents: FillPrice = {
  usdPerBaseUnit: { numerator: 4n, denominator: 5n },
  decimals: 6,
};

/** The prices a fill test reads: the coin at $600 and the token at $0.80. */
export const fillPrices: ReadonlyMap<AssetRef, UsdPrice> = new Map([
  [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
  [testToken, eightyCents.usdPerBaseUnit],
]);

/** A paper engine whose wallet holds one coin and, unless told none, one whole token. */
export async function startFillEngine(
  options: TestEngineOptions & { readonly tokens?: bigint } = {},
): Promise<TestEngine> {
  const { tokens = wholeToken, ...rest } = options;
  const paper = [
    { asset: testCoin, base: 10n ** 18n },
    ...(tokens === 0n ? [] : [{ asset: testToken, base: tokens }]),
  ];
  return startOrderEngine({ prices: fillPrices, paper, ...rest });
}

/** An order created from the CLI and made active on its card's Confirm. */
export async function activeOrder(test: TestEngine, request: OrderRequest): Promise<OrderRecord> {
  const created = await createdOrder(test, request);
  await tapCard(test, created.intent, "confirm");
  return storedOrder(test, created.order);
}

/** The notices the engine sent, oldest first. */
export function noticesOf(test: TestEngine): readonly JsonValue[] {
  return test.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
}

/** An order's fill rows, the newest first. */
export async function fillRowsOf(
  test: TestEngine,
  order: Id<"ord">,
): Promise<readonly OrderFillRecord[]> {
  return test.stores.orders.fills({ orderId: order, limit: 50 }, live);
}

/** The buys and sales the engine proposed for orders, in the order they last moved. */
export async function fillIntentsOf(test: TestEngine): Promise<readonly IntentRecord[]> {
  const all = await test.stores.intents.list(
    {
      states: ["paper_filled", "failed_check", "rejected_policy", "risk_blocked", "cancelled"],
      limit: 50,
    },
    live,
  );
  return all.filter(
    ({ kind, proposer }) => (kind === "buy" || kind === "sell") && proposer === "engine",
  );
}
