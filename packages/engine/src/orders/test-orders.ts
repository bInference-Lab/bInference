import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bpsSchema, type Id } from "@binference/core";
import type {
  CopyOrderRequest,
  OrderRequest,
  OrderView,
  StopLossOrderRequest,
} from "@binference/protocol";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { moveOrder } from "./order-machine.js";
import type { OrderMove, OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

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

/** The wallet the test copy order follows, on the fake chain. */
export const testLeader: AccountRef = accountRefSchema.parse("fake:1:0x00000009");

/**
 * A copy order of the test agent: copy the test leader's buys on the fake chain at $20 each, at
 * most $200 a day, spending the chain's coin, and sell the share the leader sells.
 */
export function testCopy(changes: Partial<Omit<CopyOrderRequest, "kind">> = {}): CopyOrderRequest {
  return {
    kind: "copy",
    agent: testAgent,
    token: testCoin,
    side: "buy",
    size: { usdMicros: 20_000_000n },
    trigger: { leader: testLeader, perBuyUsdMicros: 20_000_000n, dailyUsdMicros: 200_000_000n },
    reason: "Follow the wallet you named",
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

/**
 * A `TestEngineOptions.orders` wrapper where another write moves an active order first: right
 * before each of the first `times` writes that `when` picks, the order's trigger state is kept
 * again as it stands, so that write finds the order at a newer version.
 */
export function contendedOrders(
  times: number,
  when: (moves: readonly OrderMove[]) => boolean = () => true,
): {
  readonly orders: NonNullable<TestEngineOptions["orders"]>;
  /** How many writes found their order moved first so far. */
  readonly raced: () => number;
} {
  let raced = 0;
  const orders: NonNullable<TestEngineOptions["orders"]> = (store) => ({
    ...store,
    async move(moves, call) {
      const [first] = moves;
      const picked = first !== undefined && raced < times && when(moves);
      if (picked && (await keepOrderAgain(store, first.id, call))) {
        raced += 1;
      }
      return store.move(moves, call);
    },
  });
  return { orders, raced: () => raced };
}

/**
 * Another write of an active order: its trigger state kept again as it stands, which raises its
 * version. Answers whether the order moved; one that is not active does not.
 */
export async function keepOrderAgain(
  orders: Pick<OrderStore, "get" | "move">,
  order: Id<"ord">,
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const read = await orders.get(order, call);
  const triggerState = read?.triggerState ?? null;
  const kept =
    read === undefined
      ? undefined
      : moveOrder(read, { type: "trigger_kept", triggerState }, read.changedAtMs);
  const moved = kept?.ok === true ? await orders.move([kept.value], call) : undefined;
  return moved?.ok === true;
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
