import {
  accountRefSchema,
  type Amount,
  assetRefSchema,
  type SimulatedStep,
  type TxDraft,
} from "@binference/chain";
import type { StakePlan } from "@binference/chain/staking";
import { createFakeFamily, fakeDraft } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { simulateStake } from "./simulate-stake.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const voting = assetRefSchema.parse("fake:1/token:0x000000e5");
const other = assetRefSchema.parse("fake:1/token:0x000000aa");
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const hub = accountRefSchema.parse("fake:1:0x000000d1");
const burn = accountRefSchema.parse("fake:1:0x00000000");
const whole = 10n ** 18n;
const live = { signal: new AbortController().signal };

function planOf(action: StakePlan["action"]): StakePlan {
  return {
    action,
    wallet,
    validator: accountRefSchema.parse("fake:1:0x000000c1"),
    validatorName: "Active",
    commissionBps: bpsSchema.parse(700),
    jailed: false,
    paper: false,
    value: { asset: coin, base: action === "stake" ? whole : 0n },
    moved: { asset: coin, base: whole },
    ...(action === "claim" ? { parts: ["a"] } : {}),
    ...(action === "claim" ? {} : { shares: { asset: receipt, base: whole } }),
    votingToken: voting,
    unbondingSeconds: 604_800,
    plannedAtMs: 1_000,
  };
}

const out = (amount: Amount, to = hub) => ({ from: wallet, to, amount });

// Runs the plan's one call on a simulator that answers `step`.
async function judged(plan: StakePlan, step: Partial<SimulatedStep>) {
  const ran: SimulatedStep = {
    status: "success",
    gasUsed: 60_000n,
    transfers: [],
    approvals: [],
    ...step,
  };
  const steps: readonly TxDraft[] = [
    fakeDraft(wallet, { to: "0x000000d1", value: plan.value.base, data: "delegate,0x000000c1" }),
  ];
  const simulator = { simulate: async () => Promise.resolve([ran]) };
  const parts = { simulator, family: createFakeFamily(), nowMs: () => 5 };
  const result = await simulateStake(parts, { plan, steps }, live.signal);
  return result.ok ? "ran" : result.error;
}

describe("the simulation of a staking move (decision 0327)", () => {
  it("passes a stake whose coin out is its amount, and an unstake that burns its units and votes", async () => {
    const stake = await judged(planOf("stake"), { transfers: [out({ asset: coin, base: whole })] });
    const unstake = await judged(planOf("unstake"), {
      transfers: [
        out({ asset: receipt, base: whole }, burn),
        out({ asset: voting, base: whole }, burn),
      ],
    });
    expect([stake, unstake]).toStrictEqual(["ran", "ran"]);
  });

  it("refuses more coin out than the plan sends, an approval, or another token out", async () => {
    const answers = await Promise.all([
      judged(planOf("stake"), { transfers: [out({ asset: coin, base: whole + 1n })] }),
      judged(planOf("claim"), { transfers: [out({ asset: coin, base: 1n })] }),
      judged(planOf("stake"), {
        approvals: [{ owner: wallet, spender: hub, amount: { asset: other, base: 1n } }],
      }),
      judged(planOf("unstake"), { transfers: [out({ asset: other, base: 1n })] }),
    ]);
    expect(answers).toStrictEqual([
      "effects_differ",
      "effects_differ",
      "effects_differ",
      "effects_differ",
    ]);
  });

  it("lets an unstake set its own receipt units' allowance, or none, and nothing else (decision 0331)", async () => {
    const approval = (base: bigint, asset = receipt) => ({
      owner: wallet,
      spender: hub,
      amount: { asset, base },
    });
    const burned = { transfers: [out({ asset: receipt, base: whole })] };
    const answers = await Promise.all([
      judged(planOf("unstake"), { ...burned, approvals: [approval(whole), approval(0n)] }),
      judged(planOf("unstake"), { ...burned, approvals: [approval(whole + 1n)] }),
      judged(planOf("unstake"), { ...burned, approvals: [approval(whole, other)] }),
      judged(planOf("stake"), { approvals: [approval(whole)] }),
    ]);
    expect(answers).toStrictEqual(["ran", "effects_differ", "effects_differ", "effects_differ"]);
  });

  it("names a call that reverted", async () => {
    await expect(judged(planOf("stake"), { status: "reverted" })).resolves.toBe(
      "simulation_reverted",
    );
  });
});
