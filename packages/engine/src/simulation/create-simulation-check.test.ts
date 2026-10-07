import {
  accountRefSchema,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import { createFakeTxSimulator, fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import { bpsSchema, type Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import { simulatorContract } from "../contracts/simulator-contract.js";
import { testNowMs } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { createSimulationCheck } from "./create-simulation-check.js";
import { coins, effectAccounts, moved, others, saleSteps, step, tokens } from "./test-effects.js";

const { wallet, thief } = effectAccounts;
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const approve = fakeDraft(wallet, {
  to: "0x0000000a",
  value: 0n,
  data: fakeApprovalData("0x0000000b", 1_000_000n),
});
const swap = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap" });
const skim = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap,skim" });
const [approved = step([]), swapped = step([])] = saleSteps();
const [, skimmed = step([])] = saleSteps([moved(wallet, thief, others(1n))]);
const table = new Map<string, SimulatedStep>([
  [approve.payload, approved],
  [swap.payload, swapped],
  [skim.payload, skimmed],
]);
const live = { signal: new AbortController().signal };

function built(steps: readonly TxDraft[]): BuiltQuote {
  return {
    quote: {
      route: [{ venue: "fake-swap", shareBps: bpsSchema.parse(10_000) }],
      amountIn: tokens(1_000_000n),
      expectedOut: coins(2_000_000n),
      minOut: coins(1_990_000n),
      priceImpactBps: bpsSchema.parse(10),
      gas: coins(0n),
      quotedAt: testNowMs - 1_000,
      expiresAt: testNowMs + 59_000,
    },
    steps,
  };
}

// A simulator that counts its calls, so a test sees which plans run nothing.
function counted(simulator: TxSimulator): { simulator: TxSimulator; calls: () => number } {
  let calls = 0;
  return {
    simulator: {
      simulate: async (drafts, options) => {
        calls += 1;
        return simulator.simulate(drafts, options);
      },
    },
    calls: () => calls,
  };
}

function setup(simulator: TxSimulator = createFakeTxSimulator(table)) {
  const spy = counted(simulator);
  const check = createSimulationCheck({
    simulator: spy.simulator,
    chains: testChains(),
    clock: createManualClock(testNowMs),
  });
  return { check, calls: spy.calls };
}

describe("simulation check", () => {
  it.each(
    simulatorContract({
      create: () => ({
        simulator: setup().check,
        matching: { intent, built: built([approve, swap]) },
        differing: { intent, built: built([approve, skim]) },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives the wallet's net changes when the simulation was run", async () => {
    await expect(
      setup().check.simulate(intent, built([approve, swap]), live),
    ).resolves.toStrictEqual({
      ok: true,
      value: { spent: [tokens(1_000_000n)], received: [coins(2_000_000n)], simulatedAt: testNowMs },
    });
  });

  it("refuses a hidden transfer of the wallet's other funds as effects that differ", async () => {
    await expect(
      setup().check.simulate(intent, built([approve, skim]), live),
    ).resolves.toStrictEqual({ ok: false, error: "effects_differ" });
  });

  it("refuses a step that reverts as a reverted simulation", async () => {
    // The fake simulator reverts a draft its table does not hold.
    const failing = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap,fails" });
    await expect(
      setup().check.simulate(intent, built([approve, failing]), live),
    ).resolves.toStrictEqual({ ok: false, error: "simulation_reverted" });
  });

  it("takes the allowances the wallet may set from the plan's approval steps", async () => {
    await expect(setup().check.simulate(intent, built([swap]), live)).resolves.toStrictEqual({
      ok: false,
      error: "effects_differ",
    });
  });

  it.each([
    ["no step", []],
    ["a step from another sender", [approve, { ...swap, from: thief }]],
    [
      "a step on another chain",
      [approve, { ...swap, chain: "fake:2", from: accountRefSchema.parse("fake:2:0x0000000c") }],
    ],
    ["a draft its family cannot read", [approve, { ...swap, payload: "unreadable" }]],
    [
      "a chain the registry does not hold",
      [{ ...swap, chain: "fake:2", from: accountRefSchema.parse("fake:2:0x0000000c") }],
    ],
  ] as const)("refuses a plan with %s, simulating nothing", async (_name, steps) => {
    const { check, calls } = setup();
    await expect(
      check.simulate(intent, built(steps as readonly TxDraft[]), live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "effects_differ",
    });
    expect(calls()).toBe(0);
  });

  it("refuses an answer for another number of steps", async () => {
    const short: TxSimulator = { simulate: async () => Promise.resolve([approved]) };
    await expect(
      setup(short).check.simulate(intent, built([approve, swap]), live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "effects_differ",
    });
  });

  it("rejects when the chain cannot simulate, so the intent waits", async () => {
    const down: TxSimulator = { simulate: async () => Promise.reject(new Error("node down")) };
    await expect(setup(down).check.simulate(intent, built([approve, swap]), live)).rejects.toThrow(
      "node down",
    );
  });
});
