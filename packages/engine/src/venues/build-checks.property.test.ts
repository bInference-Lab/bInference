import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type DecodedEffect,
} from "@binference/chain";
import { createFakeFamily, fakeDraft } from "@binference/chain/testing";
import { bpsPerWhole, type Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ApprovalStep,
  checkSteps,
  minOutFloor,
  type TradeBounds,
  type TradeStep,
} from "./build-checks.js";

const nowMs = 1_800_000_000_000;
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const bounds: TradeBounds = {
  wallet,
  amountIn: { asset: token, base: 500n },
  assetOut: coin,
  nativeAsset: coin,
  contracts: [router],
  minOutBase: 990n,
  latestDeadlineMs: nowMs + 60_000,
  family: createFakeFamily(),
};
const address = fc.stringMatching(/^0x[0-9a-fA-F]{8}$/);

function trade(changes: Partial<DecodedEffect>, target = router): TradeStep {
  return {
    kind: "trade",
    draft: fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap" }),
    call: { target, nativeValue: 0n },
    effect: {
      recipient: wallet,
      amountIn: bounds.amountIn,
      minOut: { asset: coin, base: bounds.minOutBase },
      deadlineMs: bounds.latestDeadlineMs,
      ...changes,
    },
  };
}

function approval(amountBase: bigint): ApprovalStep {
  return {
    kind: "approval",
    draft: fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve" }),
    call: { target: accountRefSchema.parse("fake:1:0x0000000a"), nativeValue: 0n },
    approval: { asset: token, spender: router, amountBase },
  };
}

// Addresses of the fake family other than one, and one address written in every case.
function otherThan(own: string): fc.Arbitrary<string> {
  return address.filter((text) => text.toLowerCase() !== own);
}

function anyCaseOf(own: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: 8, maxLength: 8 })
    .map((upper: readonly boolean[]) =>
      upper.map((isUpper, index) =>
        isUpper ? own.charAt(index + 2).toUpperCase() : own.charAt(index + 2),
      ),
    )
    .map((digits: readonly string[]) => `0x${digits.join("")}`);
}

function accountAt(text: string): AccountRef {
  return accountRefSchema.parse(`fake:1:${text}`);
}

describe("build-step check invariants", () => {
  it("refuses every trade call that pays an account other than the wallet", () => {
    fc.assert(
      fc.property(otherThan("0x0000000c"), (text) => {
        expect(checkSteps([trade({ recipient: accountAt(text) })], bounds)).toStrictEqual({
          ok: false,
          error: "other_recipient",
        });
      }),
    );
  });

  it("passes a trade call that pays the wallet, whatever the address's case", () => {
    fc.assert(
      fc.property(anyCaseOf("0x0000000c"), (text) => {
        expect(checkSteps([trade({ recipient: accountAt(text) })], bounds).ok).toBe(true);
      }),
    );
  });

  it("refuses every trade call to a contract the venue did not declare", () => {
    fc.assert(
      fc.property(otherThan("0x0000000b"), (text) => {
        expect(checkSteps([trade({}, accountAt(text))], bounds)).toStrictEqual({
          ok: false,
          error: "undeclared_contract",
        });
      }),
    );
  });

  it("refuses every minimum out below the policy's and passes every one at or above it", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: bounds.minOutBase - 1n }),
        fc.bigInt({ min: bounds.minOutBase, max: 2n ** 128n }),
        (below, above) => {
          expect(
            checkSteps([trade({ minOut: { asset: coin, base: below } })], bounds),
          ).toStrictEqual({
            ok: false,
            error: "low_min_out",
          });
          expect(checkSteps([trade({ minOut: { asset: coin, base: above } })], bounds).ok).toBe(
            true,
          );
        },
      ),
    );
  });

  it("refuses every deadline past 60 seconds and passes every one before", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (late, early) => {
          const latest = bounds.latestDeadlineMs;
          expect(checkSteps([trade({ deadlineMs: latest + late })], bounds)).toStrictEqual({
            ok: false,
            error: "late_deadline",
          });
          expect(checkSteps([trade({ deadlineMs: latest - early })], bounds).ok).toBe(true);
        },
      ),
    );
  });

  it("refuses every approval that is not exactly the input", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 256n }).filter((amount) => amount !== bounds.amountIn.base),
        (amountBase) => {
          expect(checkSteps([approval(amountBase), trade({})], bounds)).toStrictEqual({
            ok: false,
            error: "other_approval",
          });
        },
      ),
    );
  });

  it("sets the policy's minimum out to the exact ceiling of what the slippage keeps", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 160n }),
        fc.integer({ min: 0, max: bpsPerWhole }),
        (expectedOut, slippage) => {
          const floor = minOutFloor(expectedOut, slippage as Bps);
          const whole = BigInt(bpsPerWhole);
          const over = floor * whole - expectedOut * BigInt(bpsPerWhole - slippage);
          expect(over >= 0n).toBe(true);
          expect(over < whole).toBe(true);
          expect(floor <= expectedOut).toBe(true);
        },
      ),
    );
  });
});
