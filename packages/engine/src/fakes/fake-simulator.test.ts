import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { type Bps, err, type Id, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import { simulatorContract } from "../contracts/simulator-contract.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import { createFakeSimulator } from "./fake-simulator.js";

const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const matching = "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">;
const differing = "int_0190f1c2-3b4c-7d5e-8f60-000000000000" as Id<"int">;
const built: BuiltQuote = {
  quote: {
    route: [{ venue: "venue-a", shareBps: 10_000 as Bps }],
    amountIn: { asset: coin, base: 10n ** 17n },
    expectedOut: { asset: token, base: 1_010_000n },
    minOut: { asset: token, base: 1_000_000n },
    priceImpactBps: 8 as Bps,
    gas: { asset: coin, base: 10n ** 13n },
    quotedAt: 20_000,
    expiresAt: 80_000,
  },
  steps: [{ chain: "fake:1" as ChainRef, from: "fake:1:wallet" as AccountRef, payload: "0x01" }],
};
const simulation = {
  spent: [{ asset: coin, base: 10n ** 17n }],
  received: [{ asset: token, base: 1_010_000n }],
  simulatedAt: 20_500,
};

describe("fake simulator", () => {
  it.each(
    simulatorContract({
      create: () => ({
        simulator: createFakeSimulator(
          new Map<Id<"int">, Result<SimulationView, SimulationFailure>>([
            [matching, ok(simulation)],
            [differing, err("effects_differ")],
          ]),
        ),
        matching: { intent: matching, built },
        differing: { intent: differing, built },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("finds that steps of an intent missing from its table revert", async () => {
    const simulator = createFakeSimulator(new Map());
    const live = { signal: new AbortController().signal };
    await expect(simulator.simulate(matching, built, live)).resolves.toStrictEqual(
      err("simulation_reverted"),
    );
  });
});
