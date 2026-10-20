import { accountRefSchema } from "@binference/chain";
import { activityItemSchema, type AlertCondition, launchViewSchema } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";

const live = { signal: new AbortController().signal };
const leader = accountRefSchema.parse("fake:1:0x0000aaaa");
const hash = `0x${"cd".repeat(32)}`;

interface AskedAlert {
  readonly condition: AlertCondition;
  readonly wake: boolean;
}

type Event =
  | { readonly kind: "price"; readonly micros: bigint }
  | { readonly kind: "trade"; readonly side: "buy" | "sell"; readonly usd: number }
  | { readonly kind: "launch"; readonly insiders: number }
  | { readonly kind: "tick"; readonly ms: number };

const conditions: fc.Arbitrary<AlertCondition> = fc.oneof(
  fc.record({
    kind: fc.constant("price" as const),
    asset: fc.constantFrom(testToken, testCoin),
    direction: fc.constantFrom("above" as const, "below" as const),
    price: fc.bigInt({ min: 1n, max: 2_000_000n }),
  }),
  fc.record(
    {
      kind: fc.constant("wallet" as const),
      account: fc.constant(leader),
      side: fc.constantFrom("buy" as const, "sell" as const),
      minUsdMicros: fc.bigInt({ min: 1n, max: 100_000_000n }),
    },
    { requiredKeys: ["kind", "account"] },
  ),
  fc.record({
    kind: fc.constant("launch" as const),
    filters: fc.record({ maxInsiders: fc.nat(4) }, { requiredKeys: [] }),
  }),
);

const events: fc.Arbitrary<Event> = fc.oneof(
  fc.bigInt({ min: 1n, max: 2_000_000n }).map((micros) => ({ kind: "price" as const, micros })),
  fc.record({
    kind: fc.constant("trade" as const),
    side: fc.constantFrom("buy" as const, "sell" as const),
    usd: fc.nat(100),
  }),
  fc.nat(5).map((insiders) => ({ kind: "launch" as const, insiders })),
  fc.integer({ min: 1, max: 4_000_000 }).map((ms) => ({ kind: "tick" as const, ms })),
);

// The intent store, counting every write any part of the engine asks of it.
function countedIntents(): {
  readonly wrap: (store: IntentStore) => IntentStore;
  readonly writes: () => number;
} {
  let writes = 0;
  return {
    wrap: (store) => ({
      ...store,
      create: async (draft, call) => {
        writes += 1;
        return store.create(draft, call);
      },
      transition: async (change, call) => {
        writes += 1;
        return store.transition(change, call);
      },
    }),
    writes: () => writes,
  };
}

async function see(test: TestEngine, event: Event): Promise<void> {
  const { alerts } = test.engine;
  if (event.kind === "price") {
    const usdPerBaseUnit = { numerator: event.micros, denominator: 10n ** 6n };
    await alerts.seePrice(
      { token: testToken, usdPerBaseUnit, decimals: 6, isThin: false, readAtMs: 0 },
      live,
    );
  } else if (event.kind === "trade") {
    const activity = activityItemSchema.parse({
      at: 1,
      block: 1,
      tx: hash,
      side: event.side,
      asset: testToken,
      amount: "1",
      counterAsset: testCoin,
      counterAmount: "1",
      valueUsdMicros: String(event.usd * 1_000_000),
    });
    await alerts.seeTrade({ account: leader, activity, assets: {} }, live);
  } else if (event.kind === "launch") {
    const launch = launchViewSchema.parse({
      chain: "fake:1",
      token: "fake:1/token:0x0000cafe",
      launchpad: "fake",
      creator: "fake:1:0x0000beef",
      quoteToken: testCoin,
      graduated: false,
      insiders: Array.from({ length: event.insiders }, (_, n) => `fake:1:0x0000000${String(n)}`),
      creatorLaunches30d: 0,
      block: 1,
      tx: hash,
      launchedAt: 1,
    });
    await alerts.seeLaunch({ launch, assets: {} }, live);
  } else {
    await test.clock.advance(event.ms);
    await test.engine.tickOrders(live);
  }
}

describe("alerts", () => {
  it("never reach the money path, whatever they watch and whatever fires them", async () => {
    const alertSets = fc.array(fc.record({ condition: conditions, wake: fc.boolean() }), {
      minLength: 1,
      maxLength: 6,
    });
    const fired = { count: 0 };
    await fc.assert(
      fc.asyncProperty(
        alertSets,
        fc.array(events, { maxLength: 15 }),
        async (asked: readonly AskedAlert[], seen: readonly Event[]) => {
          const counted = countedIntents();
          const test = await startTestEngine({ intents: counted.wrap });
          const before = { writes: counted.writes(), ledger: await test.stores.ledger.last(live) };
          await inOrder(asked, async (args) =>
            test.engine.handlers["alert/create"](testCall({ agent: testAgent, ...args })),
          );
          await inOrder(seen, async (event) => see(test, event));

          expect(counted.writes()).toBe(before.writes);
          expect(await test.stores.ledger.last(live)).toStrictEqual(before.ledger);
          expect(test.executor.taken()).toStrictEqual([]);
          expect(test.pushes.filter(({ topic }) => topic === "intent")).toStrictEqual([]);
          fired.count += test.pushes.filter(({ kind }) => kind === "alert/fired").length;
        },
      ),
      { numRuns: 40 },
    );
    // The runs fired alerts, so the property held over fires, not over nothing.
    expect(fired.count).toBeGreaterThan(0);
  });
});
