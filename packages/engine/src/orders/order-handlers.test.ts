import { type Bps, bpsSchema, err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall, testCallers } from "../operations/test-engine.js";
import { defaultOrderLifetimeMs } from "./order-rules.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };
const tenMinutesMs = 600_000;

describe("an auto order's card", () => {
  it("opens one card, and the order is active only once that card is confirmed", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    const intent = await test.stores.intents.get(view.intent, live);

    expect(view).toMatchObject({
      agent: testAgent,
      wallet: testWallet,
      kind: "stopLoss",
      state: "awaiting_confirmation",
      paper: true,
      outsideContent: false,
      fills: 0,
      maxFills: 1,
      expiresAt: testNowMs + defaultOrderLifetimeMs,
    });
    expect([intent?.kind, intent?.state]).toStrictEqual(["autoOrder", "awaiting_confirmation"]);
    expect((await storedOrder(test, view.order)).state).toBe("awaiting_confirmation");

    await tapCard(test, view.intent, "confirm");

    expect(await storedOrder(test, view.order)).toMatchObject({
      state: "active",
      cardId: view.card,
    });
    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("reconciled");
    expect(
      test.pushes.filter(({ topic }) => topic === "order").map(({ kind, data }) => [kind, data]),
    ).toMatchObject([
      ["order/created", { order: view.order, state: "awaiting_confirmation" }],
      ["order/changed", { order: view.order, state: "active", version: 1 }],
    ]);
  });

  it("cancels the order when the owner taps Cancel on its card", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);

    await tapCard(test, view.intent, "deny");

    expect((await storedOrder(test, view.order)).state).toBe("cancelled");
    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("denied");
  });

  it("expires the order with its card once the card's time is up and nobody answered", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test);
    await test.engine.tickOrders(live);
    expect((await storedOrder(test, view.order)).state).toBe("awaiting_confirmation");

    await test.clock.advance(tenMinutesMs);
    await test.engine.tickOrders(live);

    expect((await storedOrder(test, view.order)).state).toBe("expired");
    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("expired");
  });

  it("takes the tap on an order's card while the engine is locked: it signs nothing", async () => {
    const test = await startOrderEngine({
      agent: { mode: "live" },
      isLocked: () => true,
      liveOrderFills: true,
    });
    const view = await createdOrder(test);

    await tapCard(test, view.intent, "confirm");

    expect((await storedOrder(test, view.order)).state).toBe("active");
    expect(test.executor.taken()).toStrictEqual([]);
  });

  it("opens the card of an order from a turn that read outside content, in auto mode too", async () => {
    const test = await startOrderEngine({ agent: { approvalMode: "auto" } });
    const view = await createdOrder(test, testStopLoss(), testCallers.runtime);
    const marked = await createdOrder(test, testStopLoss(), {
      ...testCallers.runtime,
      turn: { hasOutsideContent: true },
    });
    const card = expectOk(
      await test.engine.handlers["intent/card"](testCall({ intent: marked.intent })),
    );

    expect([view.state, view.outsideContent]).toStrictEqual(["awaiting_confirmation", false]);
    expect([marked.state, marked.outsideContent]).toStrictEqual(["awaiting_confirmation", true]);
    expect(card.lines.map(({ key }) => key)).toContain("card.warn.outsideContent");
  });
});

describe("the rules of a new auto order", () => {
  it("fills one fill and 30 days, a trailing stop's too, unless the request names more", async () => {
    const test = await startOrderEngine();
    const trailing = await createdOrder(test, {
      ...testStopLoss(),
      kind: "trailing",
      trigger: { distanceBps: bpsSchema.parse(500) },
    });
    const limit = await createdOrder(test, {
      ...testStopLoss(),
      kind: "limit",
      side: "buy",
      size: { usdMicros: 25_000_000n },
      trigger: { price: 500_000n, direction: "below" },
      maxFills: 3,
      expiresAt: testNowMs + 60_000,
    });

    expect([trailing.maxFills, trailing.expiresAt]).toStrictEqual([
      1,
      testNowMs + defaultOrderLifetimeMs,
    ]);
    expect([limit.maxFills, limit.expiresAt]).toStrictEqual([3, testNowMs + 60_000]);
    expect(trailing.request).toMatchObject({ wallet: testWallet, token: testToken });
  });

  it("refuses a live price or DCA order while live fills are off, and takes a paper one", async () => {
    const liveEngine = await startOrderEngine({ agent: { mode: "live" } });
    const paperEngine = await startOrderEngine();
    const dca = {
      ...testStopLoss(),
      kind: "dca",
      side: "buy",
      size: { usdMicros: 1_000_000n },
      trigger: { cron: "0 9 * * *" },
    } as const;

    const refused = await liveEngine.engine.handlers["order/create"](testCall(testStopLoss()));
    expect(await liveEngine.engine.handlers["order/create"](testCall(dca))).toStrictEqual(
      err("order.live_fills_off"),
    );
    const taken = await paperEngine.engine.handlers["order/create"](testCall(testStopLoss()));

    expect(refused).toStrictEqual(err("order.live_fills_off"));
    const waiting = { states: ["awaiting_confirmation" as const], limit: 5 };
    expect(await liveEngine.stores.orders.list(waiting, live)).toStrictEqual([]);
    expect(taken.ok).toBe(true);
  });

  it("refuses an order it cannot run, storing nothing", async () => {
    const test = await startOrderEngine();
    const create = async (request: Parameters<typeof testStopLoss>[0] = {}) =>
      test.engine.handlers["order/create"](testCall(testStopLoss(request)));
    const copy = {
      ...testStopLoss(),
      kind: "copy",
      trigger: { leader: testAccount, perBuyUsdMicros: 1n, dailyUsdMicros: 2n },
    } as const;
    const dcaSale = { ...testStopLoss(), kind: "dca", trigger: { cron: "0 9 * * *" } } as const;

    expect(await test.engine.handlers["order/create"](testCall(copy))).toStrictEqual(
      err("order.kind_unavailable"),
    );
    expect(await test.engine.handlers["order/create"](testCall(dcaSale))).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(await create({ side: "buy" })).toStrictEqual(err("protocol.bad_args"));
    const tooMuch = { percentBps: 10_001 as Bps };
    expect(await create({ size: tooMuch })).toStrictEqual(err("protocol.bad_args"));
    expect(await create({ trigger: { price: 0n } })).toStrictEqual(err("protocol.bad_args"));
    expect(await create({ expiresAt: testNowMs })).toStrictEqual(err("protocol.bad_args"));
    const other = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    expect(await create({ wallet: other })).toStrictEqual(err("wallet.not_found"));
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    expect(await create({ agent: stranger })).toStrictEqual(err("agent.not_found"));
    const all = await test.stores.orders.list(
      { states: ["awaiting_confirmation"], limit: 10 },
      live,
    );
    expect(all).toStrictEqual([]);
  });

  it("refuses a price order for a token the price watcher cannot price now, storing nothing", async () => {
    const test = await startOrderEngine({ unpriceable: [testToken] });

    expect(await test.engine.handlers["order/create"](testCall(testStopLoss()))).toStrictEqual(
      err("order.unpriced_token"),
    );
    const all = await test.stores.orders.list(
      { states: ["awaiting_confirmation"], limit: 10 },
      live,
    );
    expect(all).toStrictEqual([]);
  });

  it("refuses an order of a frozen agent", async () => {
    const test = await startOrderEngine();
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));

    expect(await test.engine.handlers["order/create"](testCall(testStopLoss()))).toStrictEqual(
      err("agent.frozen"),
    );
  });
});

describe("reading auto orders", () => {
  it("answers one order with its open card, and pages through them oldest first", async () => {
    const test = await startOrderEngine();
    const first = await createdOrder(test);
    await test.clock.advance(1_000);
    const second = await createdOrder(test);
    await tapCard(test, second.intent, "deny");

    const got = expectOk(await test.engine.handlers["order/get"](testCall({ order: first.order })));
    const page = expectOk(await test.engine.handlers["order/list"](testCall({ limit: 1 })));
    const rest = expectOk(
      await test.engine.handlers["order/list"](testCall({ limit: 1, cursor: String(page.next) })),
    );
    const cancelled = expectOk(
      await test.engine.handlers["order/list"](testCall({ state: "cancelled" })),
    );

    expect(got).toMatchObject({ order: first.order, card: first.card, intent: first.intent });
    expect(page.items.map(({ order }) => order)).toStrictEqual([first.order]);
    expect(page.assets?.[testToken]?.symbol).toBe("TKN");
    expect(rest.items.map(({ order }) => order)).toStrictEqual([second.order]);
    expect(cancelled.items.map(({ order }) => order)).toStrictEqual([second.order]);
    const unknown = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    expect(await test.engine.handlers["order/get"](testCall({ order: unknown }))).toStrictEqual(
      err("order.not_found"),
    );
    expect(
      await test.engine.handlers["order/list"](testCall({ cursor: "not-a-cursor" })),
    ).toStrictEqual(err("protocol.bad_args"));
  });
});
