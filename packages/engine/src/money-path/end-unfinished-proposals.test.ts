import { createFakeTxSimulator } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryQuotaSource } from "../fakes/memory-quota-source.js";
import { startIdentityEngine, testRegistry } from "../identity/test-identities.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type IntentState, intentStates } from "../intents/intent-state.js";
import { expectOk, testAgent, testLimits, testSwap } from "../intents/test-intents.js";
import { racedTo } from "../intents/test-raced-store.js";
import { statesBeforeCard } from "../intents/transition-table.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  type TestEngine,
} from "../operations/test-engine.js";
import type { OrderRecord } from "../orders/order-record.js";
import { eightyCents } from "../orders/test-fills.js";
import { startOrderEngine, storedOrder, testStopLoss } from "../orders/test-orders.js";
import type { IntentStore } from "../ports.js";
import { rescueCustody, rescueSteps, setUpRescue, testHeld } from "../safety/test-rescue.js";
import { alertTo, createdRule, testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { testLaunch, testLaunchEngine } from "./test-launches.js";

const live = { signal: new AbortController().signal };

// An intent store that stops the run, as a crash does, once a write into `state` committed: every
// later call of the run finds its signal aborted.
function stoppedIn(
  state: IntentState,
  controller: AbortController,
): (store: IntentStore) => IntentStore {
  return (store) => ({
    ...store,
    create: async (draft, call) => {
      const created = await store.create(draft, call);
      if (draft.state === state) {
        controller.abort();
      }
      return created;
    },
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (change.state === state) {
        controller.abort();
      }
      return moved;
    },
  });
}

/** A test engine whose next run stops once it stored an intent in `state`, and that run's call. */
interface Stopping {
  readonly options: { readonly intents: (store: IntentStore) => IntentStore };
  /** A call on the stopping run's signal, which the stop aborts. */
  readonly call: <Args>(args: Args) => ReturnType<typeof testCall<Args>>;
}

function stoppingIn(state: IntentState): Stopping {
  const controller = new AbortController();
  return {
    options: { intents: stoppedIn(state, controller) },
    call: (args) => ({ ...testCall(args), signal: controller.signal }),
  };
}

// A call the stop cut short: its answer, or its fault, is lost with the stopped engine.
async function cutShort(run: Promise<unknown>): Promise<void> {
  await run.catch(() => undefined);
}

async function everyIntent(test: TestEngine): Promise<readonly IntentRecord[]> {
  return test.stores.intents.list({ states: [...intentStates], limit: 50 }, live);
}

async function onlyIntent(test: TestEngine): Promise<IntentRecord> {
  const [record, ...others] = await everyIntent(test);
  if (record === undefined || others.length > 0) {
    throw new Error("Expected one intent.");
  }
  return record;
}

async function lastCause(test: TestEngine, intent: Id<"int">): Promise<unknown> {
  const events = await test.stores.intents.events(intent, live);
  return events.at(-1)?.cause;
}

const notices = (test: TestEngine) => test.pushes.filter((push) => push.topic === "notice");

// Taps Confirm on the intent's card from the CLI; an intent without a card fails the test.
async function confirmed(test: TestEngine, view: IntentView): Promise<void> {
  if (view.card === undefined) {
    throw new Error("Expected a card.");
  }
  const tap = { intent: view.intent, card: view.card.card, cardVersion: view.card.version };
  expectOk(await test.engine.handlers["intent/confirm"](testCall(tap)));
}

// The state of the intent a call answered; a call that answered none fails the test.
async function stateOfAnswer(
  test: TestEngine,
  answer: { readonly intent?: Id<"int"> },
): Promise<IntentState | undefined> {
  if (answer.intent === undefined) {
    throw new Error("Expected an intent.");
  }
  return (await test.stores.intents.get(answer.intent, live))?.state;
}

describe("the start's end of the proposals a stop left before their cards", () => {
  it.each(statesBeforeCard)(
    "cancels a swap a stop left in %s, unsigned, with no card and no notice",
    async (state) => {
      const stop = stoppingIn(state);
      const test = await startTestEngine(stop.options);
      await cutShort(test.engine.handlers["intent/propose"](stop.call(testSwap())));
      const left = await onlyIntent(test);
      expect(left.state).toBe(state);

      await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(1);

      await expect(onlyIntent(test)).resolves.toMatchObject({ state: "cancelled" });
      await expect(lastCause(test, left.id)).resolves.toStrictEqual({
        trigger: "cancel_requested",
        by: "engine",
        cancelCause: "engine_stopping",
      });
      await expect(test.stores.intents.cards(left.id, live)).resolves.toStrictEqual([]);
      expect(notices(test)).toStrictEqual([]);
    },
  );

  it.each(["paper", "live"] as const)("cancels a %s proposal alike", async (mode) => {
    const stop = stoppingIn("checked");
    const test = await startTestEngine({ ...stop.options, agent: { mode, limits: testLimits } });
    await cutShort(test.engine.handlers["intent/propose"](stop.call(testSwap())));
    expect((await onlyIntent(test)).isPaper).toBe(mode === "paper");

    await test.restart().endUnfinishedProposals(live);

    await expect(onlyIntent(test)).resolves.toMatchObject({ state: "cancelled" });
  });

  it("leaves an intent at its card or past it as it stands", async () => {
    const test = await startTestEngine();
    const waiting = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
    const filled = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
    await confirmed(test, filled);
    const before = await everyIntent(test);

    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(0);

    expect(before.map(({ state }) => state).toSorted()).toStrictEqual([
      "awaiting_confirmation",
      "paper_filled",
    ]);
    await expect(everyIntent(test)).resolves.toStrictEqual(before);
    expect(waiting.state).toBe("awaiting_confirmation");
  });

  it("counts no intent whose cancel lost to another write, and moves it no further", async () => {
    const stop = stoppingIn("quoted");
    const raced = racedTo("cancelled");
    const test = await startTestEngine({ intents: (store) => raced(stop.options.intents(store)) });
    await cutShort(test.engine.handlers["intent/propose"](stop.call(testSwap())));

    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(0);

    await expect(onlyIntent(test)).resolves.toMatchObject({ state: "quoted" });
  });

  it("ends nothing a second time", async () => {
    const stop = stoppingIn("quoted");
    const test = await startTestEngine(stop.options);
    await cutShort(test.engine.handlers["intent/propose"](stop.call(testSwap())));

    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(1);
    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(0);
  });
});

describe("what lets one of its kind run at a time, after a restart", () => {
  it("opens a new rescue once the one a stop cut short before its card ended", async () => {
    const stop = stoppingIn("checked");
    const test = await startTestEngine({
      ...stop.options,
      custodyWallets: rescueCustody,
      held: testHeld,
      chainSimulator: createFakeTxSimulator(rescueSteps()),
    });
    await setUpRescue(test);
    await cutShort(test.engine.handlers["safety/rescue"](stop.call({})));
    const stuck = await onlyIntent(test);
    expect(stuck).toMatchObject({ kind: "rescue", state: "checked" });

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);
    const { intent } = expectOk(await restarted.handlers["safety/rescue"](testCall({})));

    expect(intent).not.toBe(stuck.id);
    await expect(test.stores.intents.get(intent, live)).resolves.toMatchObject({
      state: "awaiting_confirmation",
    });
  });

  it("opens a new unfreeze once the one a stop cut short before its card ended", async () => {
    const stop = stoppingIn("proposed");
    const test = await startTestEngine(stop.options);
    await setUpRescue(test);
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
    await cutShort(test.engine.handlers["safety/unfreeze"](stop.call({ agent: testAgent })));
    const stuck = (await everyIntent(test)).find(({ kind }) => kind === "unfreeze");
    expect(stuck?.state).toBe("proposed");

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);
    const asked = testCall({ agent: testAgent });
    const answer = expectOk(await restarted.handlers["safety/unfreeze"](asked));

    expect(answer.intent).not.toBe(stuck?.id);
    await expect(stateOfAnswer(test, answer)).resolves.toBe("awaiting_confirmation");
  });

  it("takes a new token launch once the one a stop left before its upload ended", async () => {
    const stop = stoppingIn("proposed");
    const { test } = await testLaunchEngine({ options: stop.options });
    await cutShort(test.engine.handlers["intent/propose"](stop.call(testLaunch)));
    expect(await onlyIntent(test)).toMatchObject({ kind: "launchToken", state: "proposed" });

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);
    const again = await restarted.handlers["intent/propose"](testCall(testLaunch, testCallers.cli));

    expect(expectOk(again).state).toBe("awaiting_confirmation");
  });

  it("leaves a token launch waiting for its pin to its pin check", async () => {
    const { test } = await testLaunchEngine({ pin: { never: true } });
    const waiting = expectOk(
      await test.engine.handlers["intent/propose"](testCall(testLaunch, testCallers.cli)),
    );
    expect(waiting.state).toBe("quoted");

    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(0);

    await expect(onlyIntent(test)).resolves.toMatchObject({ state: "quoted" });
  });

  it("takes a new identity registration once the one a stop cut short ended", async () => {
    const stop = stoppingIn("proposed");
    const test = await startIdentityEngine(testRegistry(), stop.options);
    await cutShort(test.engine.handlers["identity/register"](stop.call({ agent: testAgent })));
    expect(await onlyIntent(test)).toMatchObject({ kind: "registerIdentity", state: "proposed" });

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);
    const again = await restarted.handlers["identity/register"](testCall({ agent: testAgent }));

    expect(expectOk(again).state).toBe("awaiting_confirmation");
  });
});

async function onlyOrder(test: TestEngine): Promise<OrderRecord> {
  const [order, ...others] = await test.stores.orders.list(
    { states: ["awaiting_confirmation", "active", "cancelled", "expired"], limit: 5 },
    live,
  );
  if (order === undefined || others.length > 0) {
    throw new Error("Expected one order.");
  }
  return order;
}

describe("an auto order's or a webhook rule's card a stop left before the card", () => {
  it("ends the order with its card, out of the open orders' quota, and fills nothing", async () => {
    const stop = stoppingIn("proposed");
    const quotas = createMemoryQuotaSource({ openOrders: 1 });
    const test = await startOrderEngine({ ...stop.options, quotas });
    await cutShort(test.engine.handlers["order/create"](stop.call(testStopLoss())));
    const left = await onlyOrder(test);
    expect(left.state).toBe("awaiting_confirmation");
    await expect(test.stores.intents.get(left.intentId, live)).resolves.toMatchObject({
      kind: "autoOrder",
      state: "proposed",
    });

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);

    await expect(storedOrder(test, left.id)).resolves.toMatchObject({ state: "cancelled" });
    const fill = await restarted.fillOrder({ order: left.id, price: eightyCents }, live);
    expect(fill).toBe("inactive");
    const again = await restarted.handlers["order/create"](testCall(testStopLoss()));
    expect(expectOk(again).state).toBe("awaiting_confirmation");
  });

  it("deletes the rule with its card, out of the agent's 20 rules, and takes no alert", async () => {
    // The move of the rule's card to `checked` is lost, so its intent stays `proposed` as a stop
    // leaves it, and the call still answers the rule's URL, which the alert below needs.
    const test = await startOrderEngine({ intents: racedTo("checked", 1) });
    const left = await createdRule(test);
    await expect(test.stores.intents.get(left.intent, live)).resolves.toMatchObject({
      kind: "webhookRule",
      state: "proposed",
    });

    const restarted = test.restart();
    await restarted.endUnfinishedProposals(live);

    await expect(test.stores.webhookRules.get(left.rule, live)).resolves.toMatchObject({
      state: "deleted",
    });
    expect(await alertTo(test, left.url)).toBe("not_found");
    const create = restarted.handlers["webhookRule/create"];
    const twenty = await Promise.all(
      Array.from({ length: 20 }, async () => create(testCall(testRuleRequest()))),
    );
    expect(twenty.filter((created) => !created.ok)).toStrictEqual([]);
  });
});
