import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { stakePlanSchema } from "./stake-plan.js";

const coin = "fake:1/slip44:1";
const receipt = "fake:1/token:0x000000c1";
const units = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const epochMs = fc.integer({ min: 0, max: 2 ** 52 });
const unbonding = fc.integer({ min: 0, max: 30 * 86_400 });
const base = {
  wallet: "fake:1:0x000000a1",
  validator: "fake:1:0x000000c1",
  validatorName: "Validator",
  commissionBps: 700,
  jailed: false,
  paper: false,
};

describe("stake plans on the wire", () => {
  it("decode and encode any stake, unstake or claim without a change", () => {
    fc.assert(
      fc.property(
        units,
        units,
        fc.record({ seconds: unbonding, at: epochMs, paper: fc.boolean() }),
        (moved, shares, { seconds, at, paper }) => {
          const zero = { asset: coin, base: "0" };
          const amount = { asset: coin, base: moved.toString() };
          const minted = { asset: receipt, base: shares.toString() };
          const pool = { shares: minted, coin: amount };
          const common = {
            ...base,
            paper,
            moved: amount,
            unbondingSeconds: seconds,
            plannedAtMs: at,
          };
          const wires = [
            {
              ...common,
              action: "stake" as const,
              value: amount,
              shares: minted,
              pool,
              aprBps: 350,
            },
            {
              ...common,
              action: "stake" as const,
              value: amount,
              shares: { asset: receipt, base: (shares / 2n + 1n).toString() },
              minShares: { asset: receipt, base: (shares / 4n + 1n).toString() },
              pool,
            },
            {
              ...common,
              action: "unstake" as const,
              jailed: true,
              value: zero,
              shares: minted,
              pool,
              readyAtMs: at + seconds * 1_000,
            },
            { ...common, action: "claim" as const, value: zero, parts: ["0x000000c1:3"] },
          ];
          for (const wire of wires) {
            expect(z.encode(stakePlanSchema, z.decode(stakePlanSchema, wire))).toStrictEqual(wire);
          }
        },
      ),
    );
  });

  it("refuses coin sent by an unstake or claim, parts that fit another action, a jailed stake, least shares off the stake, a name out of bounds or a rate no venue pays", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 2n ** 128n }), epochMs, (sent, at) => {
        const amount = { asset: coin, base: sent.toString() };
        const minted = { asset: receipt, base: sent.toString() };
        const pool = { shares: minted, coin: amount };
        const common = { ...base, moved: amount, unbondingSeconds: 60, plannedAtMs: at };
        const stake = { ...common, action: "stake", value: amount, shares: minted, pool };
        const wrong: readonly Readonly<Record<string, unknown>>[] = [
          { ...common, action: "claim", value: amount, parts: ["a"] },
          { ...common, action: "claim", value: { asset: coin, base: "0" }, parts: [] },
          { ...stake, parts: ["a"] },
          { ...stake, readyAtMs: at },
          { ...stake, jailed: true },
          { ...common, action: "stake", value: amount },
          { ...common, action: "unstake", value: { asset: coin, base: "0" }, shares: minted, pool },
          { ...stake, wallet: "fake:2:0x000000a1" },
          { ...stake, value: { asset: "fake:2/slip44:1", base: "1" } },
          { ...stake, commissionBps: 10_001 },
          { ...stake, validatorName: "" },
          { ...stake, validatorName: "v".repeat(65) },
          { ...stake, validatorName: "Binance\u202E" },
          { ...stake, aprBps: 1_000_001 },
          { ...stake, aprBps: 1.5 },
          { ...stake, minShares: { asset: receipt, base: (sent + 1n).toString() } },
          { ...stake, minShares: { asset: receipt, base: "0" } },
          { ...stake, minShares: { asset: coin, base: "1" } },
          {
            ...common,
            action: "unstake",
            value: { asset: coin, base: "0" },
            shares: minted,
            minShares: minted,
            pool,
            readyAtMs: at,
          },
        ];
        expect(wrong.map((item) => stakePlanSchema.safeParse(item).success)).toStrictEqual(
          wrong.map(() => false),
        );
      }),
    );
  });
});
