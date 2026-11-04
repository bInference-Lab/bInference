import { assetRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, err } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { createdRule, testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { activeOrder, eightyCents, fillRowsOf, noticesOf, startFillEngine } from "./test-fills.js";
import { createdOrder, startOrderEngine, testCopy, testStopLoss } from "./test-orders.js";

// The test agent's slippage limits: 0.5% on a pair of registry tokens, 3% on any other pair.
const registryLimit = bpsSchema.parse(50);
const otherLimit = bpsSchema.parse(300);
const over = (limit: Bps): Bps => bpsSchema.parse(limit + 1);
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const live = { signal: new AbortController().signal };

// Each kind of auto order on the registry's test token, asking each fill for `slippage`.
function ordersAsking(slippage: Bps): readonly (readonly [string, OrderRequest])[] {
  const maxSlippageBps = slippage;
  const buy = { side: "buy", size: { usdMicros: 25_000_000n }, maxSlippageBps } as const;
  return [
    ["limit", { ...testStopLoss(buy), kind: "limit", trigger: { price: 1n, direction: "below" } }],
    ["takeProfit", { ...testStopLoss({ maxSlippageBps }), kind: "takeProfit" }],
    ["stopLoss", testStopLoss({ maxSlippageBps })],
    [
      "trailing",
      { ...testStopLoss({ maxSlippageBps }), kind: "trailing", trigger: { distanceBps: slippage } },
    ],
    ["dca", { ...testStopLoss(buy), kind: "dca", trigger: { cron: "0 9 * * *" } }],
  ];
}

// The orders, rules and intents the engine holds: none after a refusal.
async function createdNothing(test: Awaited<ReturnType<typeof startOrderEngine>>) {
  const { handlers } = test.engine;
  const orders = expectOk(await handlers["order/list"](testCall({})));
  const rules = expectOk(await handlers["webhookRule/list"](testCall({})));
  const intents = expectOk(await handlers["intent/list"](testCall({})));
  return [orders.items, rules.items, intents.items];
}

describe("a new auto order's slippage", () => {
  it.each(ordersAsking(over(registryLimit)))(
    "refuses a %s order asking more than the agent's limit, before any card",
    async (_kind, request) => {
      const test = await startOrderEngine();
      const refused = await test.engine.handlers["order/create"](testCall(request));

      expect(refused).toStrictEqual(err("order.slippage_limit"));
      expect(await createdNothing(test)).toStrictEqual([[], [], []]);
    },
  );

  it.each(ordersAsking(registryLimit))(
    "takes a %s order asking the agent's limit",
    async (_kind, request) => {
      const test = await startOrderEngine();
      const view = await createdOrder(test, request);

      expect([view.state, view.request.maxSlippageBps]).toStrictEqual([
        "awaiting_confirmation",
        registryLimit,
      ]);
    },
  );

  it("judges a token the registry does not list by the agent's limit for any other pair", async () => {
    const facts = new Map([[unlisted, { symbol: "XVS", name: "Venus", decimals: 18 }]]);
    const test = await startOrderEngine({ tokenFacts: createFakeTokenFacts({ facts }).read });
    const at = testStopLoss({ token: unlisted, maxSlippageBps: otherLimit });
    const past = testStopLoss({ token: unlisted, maxSlippageBps: over(otherLimit) });

    expect((await createdOrder(test, at)).state).toBe("awaiting_confirmation");
    expect(await test.engine.handlers["order/create"](testCall(past))).toStrictEqual(
      err("order.slippage_limit"),
    );
  });

  it("refuses a copy order asking more than both limits, as only a fill knows its token", async () => {
    const test = await startOrderEngine();
    const past = testCopy({ maxSlippageBps: over(otherLimit) });

    expect(await test.engine.handlers["order/create"](testCall(past))).toStrictEqual(
      err("order.slippage_limit"),
    );
    expect(await createdNothing(test)).toStrictEqual([[], [], []]);
    const at = await createdOrder(test, testCopy({ maxSlippageBps: otherLimit }));
    expect(at.state).toBe("awaiting_confirmation");
  });
});

describe("an active order's slippage once its agent's limit is tightened", () => {
  it("skips each fill with slippage, as the policy judges it, and tells the owner", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss({ maxSlippageBps: registryLimit }));
    const tightened = { slippageRegistryBps: bpsSchema.parse(40) };
    expectOk(
      await test.engine.handlers["limit/set"](testCall({ agent: testAgent, changes: tightened })),
    );

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "slippage" }]);
    expect(noticesOf(test).at(-1)).toMatchObject({
      key: "notice.skipped",
      parts: { reason: { key: "reason.slippage" } },
    });
  });
});

describe("a new webhook rule's slippage", () => {
  it.each([
    ["buy", { usdMicros: 20_000_000n }],
    ["sell", { percentBps: bpsSchema.parse(5_000) }],
  ] as const)(
    "refuses a rule that %ss asking more than the agent's limit, before any card",
    async (side, size) => {
      const test = await startOrderEngine();
      const asking = (maxSlippageBps: Bps) => testRuleRequest({ side, size, maxSlippageBps });
      const refused = await test.engine.handlers["webhookRule/create"](
        testCall(asking(over(registryLimit))),
      );

      expect(refused).toStrictEqual(err("order.slippage_limit"));
      expect(await createdNothing(test)).toStrictEqual([[], [], []]);
      const taken = await createdRule(test, asking(registryLimit));
      expect((await test.stores.webhookRules.get(taken.rule, live))?.state).toBe(
        "awaiting_confirmation",
      );
    },
  );
});
