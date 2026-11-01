import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { createFakeStakingVenue, fakeDraft } from "@binference/chain/testing";
import { BinferenceError, bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { defineStaking } from "./define-staking.js";
import { stakingVenueContract } from "./testing.js";

const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const coin = assetRefSchema.parse("fake:1/slip44:1");

function fake() {
  return createFakeStakingVenue({
    validators: [
      { address: "0x000000c1", name: "Active", commissionBps: bpsSchema.parse(500) },
      { address: "0x000000c2", name: "Jailed", commissionBps: bpsSchema.parse(500), jailed: true },
    ],
    minStakeBase: 10n,
    unbondingSeconds: 3_600,
    nowMs: 1_800_000_000_000,
  });
}

function refusalOf(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof BinferenceError ? error.code : error;
  }
}

describe("defineStaking", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const inner = fake();
        return await Promise.resolve({
          venue: defineStaking(inner),
          wallet,
          active: accountRefSchema.parse("fake:1:0x000000c1"),
          jailed: accountRefSchema.parse("fake:1:0x000000c2"),
          unknown: accountRefSchema.parse("fake:1:0x000000c3"),
          stake: { asset: coin, base: 20n },
          foreign: [fakeDraft(wallet, { to: "0x000000d1", value: 1n, data: "delegate,0x1" })],
          run: async (drafts) => await Promise.resolve(inner.run(drafts)),
          wait: async (seconds) => {
            inner.wait(seconds);
            await Promise.resolve();
          },
        });
      },
    }),
  )("keeps the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("freezes what it declares", () => {
    const venue = defineStaking(fake());
    expect(Object.isFrozen(venue)).toBe(true);
    expect(Object.isFrozen(venue.contracts[0]?.names)).toBe(true);
  });

  it("refuses contracts on another chain, none at all, or a bridge deposit", () => {
    const other = chainRefSchema.parse("fake:2");
    const bridge = {
      contract: "hub",
      abi: {},
      walletInputs: [],
      bridge: {
        recipient: "to",
        destinationChain: "chain",
        tokenIn: "a",
        tokenOut: "b",
        minOut: "least",
        emptyInputs: [],
      },
    };
    const cases = [
      { ...fake(), contracts: [{ chain: other, names: ["hub"] }] },
      { ...fake(), contracts: [] },
      { ...fake(), contracts: [{ chain: fake().chain, names: ["hub"], calls: [bridge] }] },
      { ...fake(), id: "Not An Id" },
    ];
    expect(cases.map((item) => refusalOf(() => defineStaking(item)))).toStrictEqual(
      cases.map(() => "plugin.bad_venue"),
    );
  });
});
