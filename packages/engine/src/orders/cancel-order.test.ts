import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };

describe("cancelling an auto order", () => {
  it("ends an active order at once, with no card", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    await tapCard(test, view.intent, "confirm");
    const cardsBefore = await test.stores.intents.cards(view.intent, live);

    const cancelled = expectOk(
      await test.engine.handlers["order/cancel"](testCall({ order: view.order })),
    );

    expect(cancelled.state).toBe("cancelled");
    expect((await storedOrder(test, view.order)).state).toBe("cancelled");
    expect(await test.stores.intents.cards(view.intent, live)).toStrictEqual(cardsBefore);
    expect(
      test.pushes.filter(({ kind }) => kind === "order/changed").map(({ data }) => data),
    ).toMatchObject([{ state: "active" }, { state: "cancelled" }]);
  });

  it("closes the card of an order that waits for it, so a late tap starts nothing", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);

    expectOk(await test.engine.handlers["order/cancel"](testCall({ order: view.order })));
    const answer = { intent: view.intent, decision: "confirm", cardVersion: 1 } as const;
    const late = await test.engine.answer(
      { ...answer, answeredBy: { surface: "telegram", by: "telegram" } },
      live,
    );

    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("cancelled");
    expect(expectOk(late).outcome.verdict).toBe("closed");
    expect((await storedOrder(test, view.order)).state).toBe("cancelled");
  });

  it("lets the runtime and the owner cancel any order, and an MCP client only its own", async () => {
    const test = await startOrderEngine();
    const owners = await createdOrder(test, testStopLoss());
    const clients = await createdOrder(test, testStopLoss(), testCallers.mcp);
    const runtimes = await createdOrder(test, testStopLoss(), testCallers.runtime);
    const cancel = async (order: typeof owners.order, caller: typeof testCallers.cli) =>
      test.engine.handlers["order/cancel"](testCall({ order }, caller));

    expect(await cancel(owners.order, testCallers.mcp)).toStrictEqual(err("auth.scope"));
    expect(expectOk(await cancel(clients.order, testCallers.mcp)).state).toBe("cancelled");
    expect(expectOk(await cancel(owners.order, testCallers.runtime)).state).toBe("cancelled");
    expect(expectOk(await cancel(runtimes.order, testCallers.cli)).state).toBe("cancelled");
  });

  it("refuses an order that ended or does not exist", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    await tapCard(test, view.intent, "deny");
    const unknown = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");

    expect(
      await test.engine.handlers["order/cancel"](testCall({ order: view.order })),
    ).toStrictEqual(err("order.wrong_state"));
    expect(await test.engine.handlers["order/cancel"](testCall({ order: unknown }))).toStrictEqual(
      err("order.not_found"),
    );
  });
});
