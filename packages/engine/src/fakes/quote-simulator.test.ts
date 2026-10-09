import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { simulatorContract } from "../contracts/simulator-contract.js";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { createQuoteSimulator } from "./quote-simulator.js";

const matching = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const differing = "int_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"int">;
const refusals = new Map([[differing, "effects_differ" as const]]);
const built = {
  quote: {
    route: [],
    amountIn: { asset: testCoin, base: 1_000_000n },
    expectedOut: { asset: testToken, base: 2_000_000n },
    minOut: { asset: testToken, base: 1_990_000n },
    priceImpactBps: 10 as never,
    gas: { asset: testCoin, base: 0n },
    quotedAt: testNowMs,
    expiresAt: testNowMs + 60_000,
  },
  steps: [],
};

describe("quote simulator", () => {
  it.each(
    simulatorContract({
      create: () => ({
        simulator: createQuoteSimulator((intent) => refusals.get(intent)),
        matching: { intent: matching, built },
        differing: { intent: differing, built },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reports the quote's input as spent, its expected output as received, and no gas", async () => {
    const simulator = createQuoteSimulator(() => undefined);
    await expect(
      simulator.simulate(matching, built, { signal: new AbortController().signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        spent: [built.quote.amountIn],
        received: [built.quote.expectedOut],
        simulatedAt: testNowMs,
        gasUsed: 0n,
      },
    });
  });

  it("measures a venue's route by its outcome: the tax it takes and the gas it uses", async () => {
    const routes = new Map([["fake-swap", { keptBps: 9_970n, gasUsed: 150_000n }]]);
    const simulator = createQuoteSimulator(() => undefined, routes);
    const taxed = {
      ...built,
      quote: { ...built.quote, route: [{ venue: "fake-swap", shareBps: 10_000 as never }] },
    };
    await expect(
      simulator.simulate(matching, taxed, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      ok: true,
      value: { received: [{ asset: testToken, base: 1_994_000n }], gasUsed: 150_000n },
    });
  });
});
