import { createFakeTxSimulator } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../agents/agent-record.js";
import { heldErrorOf, withBreakerHold } from "../agents/breaker-hold.js";
import { breakerWrite } from "../contracts/breaker-freeze-checks.js";
import { createMemoryBreaker, type MemoryBreaker } from "../fakes/memory-breaker.js";
import { expectOk, testAgent, testNowMs, testSwap } from "../intents/test-intents.js";
import {
  startTestEngine,
  testCall,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { agentRefusal } from "../orders/create-order.js";
import type { OrderStore } from "../orders/ports.js";
import { testStopLoss } from "../orders/test-orders.js";
import type { WebhookRuleStore } from "../webhooks/ports.js";
import { testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { rescueCustody, rescueSteps, setUpRescue, testHeld } from "./test-rescue.js";

const live = { signal: new AbortController().signal };

// An engine whose install holds wallets a rescue moves, its stores as `wrappers` wrap them.
async function rescueEngine(wrappers: Pick<TestEngineOptions, "orders" | "webhookRules"> = {}) {
  const breaker = createMemoryBreaker();
  const test = await startTestEngine({
    breaker,
    custodyWallets: rescueCustody,
    held: testHeld,
    chainSimulator: createFakeTxSimulator(rescueSteps()),
    ...wrappers,
  });
  await setUpRescue(test);
  return { test, breaker };
}

// An engine whose install holds wallets a rescue moves, once the breaker is pulled.
async function pulled(): Promise<{ readonly test: TestEngine; readonly breaker: MemoryBreaker }> {
  const { test, breaker } = await rescueEngine();
  breaker.pull(testNowMs);
  await test.engine.followBreaker(live);
  return { test, breaker };
}

describe("refusals while the breaker holds", () => {
  it("stores a proposal and ends it with breaker, the first policy reason", async () => {
    const { test } = await pulled();
    const proposed = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
    const stored = await test.stores.intents.get(proposed.intent, live);
    expect([stored?.state, stored?.reason]).toStrictEqual(["rejected_policy", "breaker"]);
  });

  it("refuses an unfreeze until the lift, storing nothing", async () => {
    const { test, breaker } = await pulled();
    await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
    const refused = await test.engine.handlers["safety/unfreeze"](testCall({ agent: testAgent }));
    expect(refused).toStrictEqual({ ok: false, error: "safety.breaker" });
    const waiting = { states: ["awaiting_confirmation" as const], limit: 10 };
    await expect(test.stores.intents.list(waiting, live)).resolves.toStrictEqual([]);
    breaker.lift(testNowMs + 1);
    await test.engine.followBreaker(live);
    const opened = await test.engine.handlers["safety/unfreeze"](testCall({ agent: testAgent }));
    expect(expectOk(opened).intent).toBeDefined();
  });

  it("lets the owner ask for a rescue, which waits for its tap", async () => {
    const { test } = await pulled();
    const asked = expectOk(await test.engine.handlers["safety/rescue"](testCall({})));
    await expect(test.stores.intents.get(asked.intent, live)).resolves.toMatchObject({
      kind: "rescue",
      state: "awaiting_confirmation",
    });
  });

  it("names the breaker in an order's and a rule's refusal, whatever the owner froze", async () => {
    const { test } = await pulled();
    expect(agentRefusal(await test.stores.agents.get(testAgent, live))).toBe("safety.breaker");
    await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
    expect(agentRefusal(await test.stores.agents.get(testAgent, live))).toBe("safety.breaker");
  });
});

// The breaker's mark written alone, as a pull whose cancels missed what was stored after its list.
async function markOnly(test: TestEngine): Promise<void> {
  const write = breakerWrite(90, { atMs: testNowMs, version: 1, isPulled: true });
  expect((await test.stores.intents.freeze(write, live)).ok).toBe(true);
}

// The breaker's mark, written once the engine runs, right before a store's create.
async function markFirst(engine: () => TestEngine | undefined): Promise<void> {
  const test = engine();
  if (test !== undefined) {
    await markOnly(test);
  }
}

// An order store whose creates meet the breaker's mark.
function markedOrders(engine: () => TestEngine | undefined): (store: OrderStore) => OrderStore {
  return (store) => ({
    ...store,
    create: async (draft, call) => {
      await markFirst(engine);
      return store.create(draft, call);
    },
  });
}

// A webhook rule store whose creates meet the breaker's mark.
function markedRules(
  engine: () => TestEngine | undefined,
): (store: WebhookRuleStore) => WebhookRuleStore {
  return (store) => ({
    ...store,
    create: async (draft, call) => {
      await markFirst(engine);
      return store.create(draft, call);
    },
  });
}

// The owner's freeze of the test agent, then the unfreeze card it opens.
async function unfreezeCardOf(test: TestEngine): Promise<Id<"int">> {
  await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
  const { intent } = expectOk(
    await test.engine.handlers["safety/unfreeze"](testCall({ agent: testAgent })),
  );
  if (intent === undefined) {
    throw new Error("Expected an unfreeze card.");
  }
  return intent;
}

// Taps Confirm on the intent's current card version from the CLI.
async function confirmOnItsCard(test: TestEngine, intent: Id<"int">) {
  const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error(`Expected intent ${intent} to have a card.`);
  }
  const args = { intent, card, cardVersion: view.card?.version ?? 1 };
  return test.engine.handlers["intent/confirm"](testCall(args));
}

describe("refusals of writes the breaker's mark met", () => {
  it("refuses the Confirm of an unfreeze card, which stays open and tells nothing", async () => {
    const { test } = await rescueEngine();
    const intent = await unfreezeCardOf(test);
    await markOnly(test);
    const pushed = test.pushes.length;
    const confirmed = await confirmOnItsCard(test, intent);
    expect(confirmed).toStrictEqual({ ok: false, error: "safety.breaker" });
    const stored = await test.stores.intents.get(intent, live);
    const [agent] = await test.stores.agents.list(live);
    expect([stored?.state, agent?.ownFrozenAtMs]).toStrictEqual([
      "awaiting_confirmation",
      testNowMs,
    ]);
    expect(test.pushes.slice(pushed).map(({ kind }) => kind)).not.toContain("notice/new");
  });

  it("names the breaker when the store refused an order the mark met", async () => {
    const holder: { test?: TestEngine } = {};
    const orders = markedOrders(() => holder.test);
    const { test } = await rescueEngine({ orders });
    holder.test = test;
    const created = await test.engine.handlers["order/create"](testCall(testStopLoss()));
    expect(created).toStrictEqual({ ok: false, error: "safety.breaker" });
  });

  it("names the breaker when the store refused a rule the mark met", async () => {
    const holder: { test?: TestEngine } = {};
    const webhookRules = markedRules(() => holder.test);
    const { test } = await rescueEngine({ webhookRules });
    holder.test = test;
    const created = await test.engine.handlers["webhookRule/create"](testCall(testRuleRequest()));
    expect(created).toStrictEqual({ ok: false, error: "safety.breaker" });
  });
});

describe("the reason a held agent is refused", () => {
  const record: AgentRecord = {
    id: testAgent,
    name: "main",
    mode: "paper",
    locale: "en",
    models: {},
    notifications: {},
    createdAtMs: 1,
    changedAtMs: 1,
    version: 0,
  };

  it("is the breaker's hold first, then the owner's freeze, else none", () => {
    expect(heldErrorOf(record)).toBeUndefined();
    expect(heldErrorOf({ ...record, frozenAtMs: 5 })).toBe("agent.frozen");
    expect(heldErrorOf(withBreakerHold(record, 7))).toBe("safety.breaker");
    expect(heldErrorOf(withBreakerHold({ ...record, frozenAtMs: 5 }, 7))).toBe("safety.breaker");
  });
});
