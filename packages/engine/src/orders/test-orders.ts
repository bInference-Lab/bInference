import { bpsSchema, type Id } from "@binference/core";
import type { OrderRequest, OrderView, StopLossOrderRequest } from "@binference/protocol";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import type { OrderRecord } from "./order-record.js";

/** A stop-loss of the test agent: sell all its test token once the price falls to $0.80. */
export function testStopLoss(
  changes: Partial<Omit<StopLossOrderRequest, "kind">> = {},
): StopLossOrderRequest {
  return {
    kind: "stopLoss",
    agent: testAgent,
    token: testToken,
    side: "sell",
    size: { percentBps: bpsSchema.parse(10_000) },
    trigger: { price: 800_000n },
    reason: "Protect the position as you asked",
    ...changes,
  };
}

/** A test engine whose agent's wallet is stored in the install, as setting it up stores it. */
export async function startOrderEngine(options: TestEngineOptions = {}): Promise<TestEngine> {
  const test = await startTestEngine(options);
  test.stores.install.addWallet(
    testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
  );
  return test;
}

/** Creates an order from a caller, which must open its card. */
export async function createdOrder(
  test: TestEngine,
  request: OrderRequest = testStopLoss(),
  caller: EngineCaller = testCallers.cli,
): Promise<OrderView & { readonly intent: Id<"int">; readonly card: Id<"crd"> }> {
  const view = expectOk(await test.engine.handlers["order/create"](testCall(request, caller)));
  const { intent, card } = view;
  if (intent === undefined || card === undefined) {
    throw new Error(`Expected order ${view.order} to wait for its card.`);
  }
  return { ...view, intent, card };
}

/** The owner's answer to the first version of an intent's card, from Telegram. */
export async function tapCard(
  test: TestEngine,
  intent: Id<"int">,
  decision: "confirm" | "deny",
): Promise<void> {
  const answeredBy = { surface: "telegram", by: "telegram" } as const;
  const answer = { intent, decision, cardVersion: 1, answeredBy };
  expectOk(await test.engine.answer(answer, { signal: new AbortController().signal }));
}

/** An order as the store keeps it now, which must exist. */
export async function storedOrder(test: TestEngine, order: Id<"ord">): Promise<OrderRecord> {
  const found = await test.stores.orders.get(order, { signal: new AbortController().signal });
  if (found === undefined) {
    throw new Error(`Expected order ${order} to be stored.`);
  }
  return found;
}

/** Freezes the test agent from the CLI. */
export async function freeze(test: TestEngine): Promise<void> {
  expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
}

/** The owner asks for the test agent's unfreeze and taps Confirm on its card. */
export async function unfreeze(test: TestEngine): Promise<void> {
  const { intent } = expectOk(
    await test.engine.handlers["safety/unfreeze"](testCall({ agent: testAgent })),
  );
  if (intent === undefined) {
    throw new Error("Expected an unfreeze card.");
  }
  await tapCard(test, intent, "confirm");
}
