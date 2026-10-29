import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testToken } from "../intents/test-intents.js";
import { testCall, testChains, type TestEngine } from "../operations/test-engine.js";
import {
  createdOrder,
  freeze,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "../orders/test-orders.js";
import { setUpRescue } from "../safety/test-rescue.js";
import { createCardPresses } from "./create-card-presses.js";
import { createCardShowings } from "./create-card-showings.js";
import { present } from "./test-venues.js";
import { writtenReceiptOf } from "./written-receipt.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;

function showingsOf(test: TestEngine) {
  return createCardShowings({
    ...test.stores,
    chains: testChains(),
    venues: { hasNoDeadline: () => false },
  });
}

// The owner's unfreeze of the test agent, or of every frozen agent, with its card open.
async function unfreezeCard(test: TestEngine, agent?: Id<"agt">): Promise<Id<"int">> {
  const args = agent === undefined ? {} : { agent };
  const { intent } = expectOk(await test.engine.handlers["safety/unfreeze"](testCall(args)));
  if (intent === undefined) {
    throw new Error("Expected an unfreeze card.");
  }
  return intent;
}

async function refOf(test: TestEngine, intent: Id<"int">): Promise<string> {
  const [card] = await test.stores.intents.cards(intent, live);
  return card?.callbackRef ?? "";
}

describe("the receipt of a confirmed card that sends nothing on chain", () => {
  it("names the agent an unfreeze unfroze, never sending", async () => {
    const test = await startOrderEngine();
    await freeze(test);
    const intent = await unfreezeCard(test, testAgent);
    await tapCard(test, intent, "confirm");

    const settled = await showingsOf(test).settled(intent, live);
    expect([settled?.ref, settled?.closing.outcome, settled?.live]).toStrictEqual([
      await refOf(test, intent),
      "confirmed",
      undefined,
    ]);
    expect(settled?.written).toStrictEqual({
      outcome: { kind: "unfrozen", scope: "agent", agent: "main" },
      assets: {},
    });
  });

  it("counts the agents a whole-install unfreeze unfroze", async () => {
    const test = await startOrderEngine();
    await setUpRescue(test);
    expectOk(await test.engine.handlers["safety/freeze"](testCall({})));
    const intent = await unfreezeCard(test);
    await tapCard(test, intent, "confirm");

    expect((await showingsOf(test).settled(intent, live))?.written).toStrictEqual({
      outcome: { kind: "unfrozen", scope: "install", agentCount: 2 },
      assets: {},
    });
  });

  it("names the paper auto order a card made active, with the token it trades", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    await tapCard(test, view.intent, "confirm");

    expect((await showingsOf(test).settled(view.intent, live))?.written).toMatchObject({
      outcome: {
        kind: "orderActive",
        isPaper: true,
        order: { kind: "autoOrder", request: testStopLoss(), maxFills: 1 },
      },
      assets: { [testToken]: { symbol: "TKN" } },
    });
  });

  it("gives the Telegram press what the auto order took effect as, so its copy says so", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    const showings = showingsOf(test);
    const presses = createCardPresses({
      intents: test.stores.intents,
      answer: test.engine.answer,
      ownerId: async () => Promise.resolve(ownerId),
      showings,
    });
    const ref = await refOf(test, view.intent);

    const standing = await presses.answer({ ref, decision: "confirm", presserId: ownerId }, live);

    expect(standing).toMatchObject({
      status: "closed",
      closing: { outcome: "confirmed" },
      written: { outcome: { kind: "orderActive", isPaper: true } },
    });
    expect(standing).not.toHaveProperty("ref");
  });

  it("says an auto order did not start when the tap came after its end", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    await tapCard(test, view.intent, "confirm");
    const record = present(await test.stores.intents.get(view.intent, live));
    const { cardId: _card, ...stored } = await storedOrder(test, view.order);
    const source = { record, agents: test.stores.agents, chains: testChains() };
    const endedAs = async (order: Readonly<typeof stored> | undefined) => {
      const orders = { byIntent: async () => Promise.resolve(order) };
      return (await writtenReceiptOf({ ...source, orders }, live))?.outcome;
    };

    expect(await endedAs({ ...stored, state: "expired" })).toStrictEqual({
      kind: "orderUnstarted",
      why: "expired",
    });
    expect(await endedAs({ ...stored, state: "cancelled" })).toStrictEqual({
      kind: "orderUnstarted",
      why: "cancelled",
    });
    expect(await endedAs(undefined)).toStrictEqual({ kind: "orderUnstarted", why: "cancelled" });
  });

  it("leaves a card that sent something, or is not reconciled yet, to the other receipts", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    const record = present(await test.stores.intents.get(view.intent, live));
    const source = { orders: test.stores.orders, agents: test.stores.agents, chains: testChains() };

    expect(await writtenReceiptOf({ ...source, record }, live)).toBeUndefined();
  });
});
