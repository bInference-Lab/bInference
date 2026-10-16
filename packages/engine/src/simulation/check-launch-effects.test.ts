import {
  accountRefSchema,
  type AssetTransfer,
  assetRefSchema,
  type SimulatedStep,
} from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { checkLaunchEffects, type LaunchEffectBounds } from "./check-launch-effects.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const pad = accountRefSchema.parse("fake:1:0x0000000d");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const usd = assetRefSchema.parse("fake:1/token:0x0000000a");
const token = assetRefSchema.parse("fake:1/token:0x000000e1");

const bounds: LaunchEffectBounds = {
  wallet,
  nativeAsset: coin,
  fee: { asset: coin, base: 2_000n },
  firstBuy: { asset: coin, base: 50n },
  token,
  minOutBase: 49_500n,
  approvals: [],
  family: createFakeFamily(),
};

const out = (asset = coin, base = 2_050n): AssetTransfer => ({
  from: wallet,
  to: pad,
  amount: { asset, base },
});
const got = (base = 50_000n, asset = token): AssetTransfer => ({
  from: pad,
  to: wallet,
  amount: { asset, base },
});

function stepOf(transfers: readonly AssetTransfer[]): SimulatedStep {
  return { status: "success", gasUsed: 21_000n, transfers, approvals: [] };
}

describe("the simulation check of a token launch", () => {
  it("passes a create call that spends the fee and the buy and gets the token", () => {
    expect(checkLaunchEffects([stepOf([out(), got()])], bounds)).toStrictEqual({
      ok: true,
      value: {
        spent: [{ asset: coin, base: 2_050n }],
        received: [{ asset: token, base: 50_000n }],
      },
    });
  });

  it("passes a token first buy that spends its token and the fee in the coin", () => {
    const tokenBuy = { ...bounds, firstBuy: { asset: usd, base: 7n } };
    const steps = [stepOf([out(coin, 2_000n), out(usd, 7n), got()])];
    expect(checkLaunchEffects(steps, tokenBuy)).toMatchObject({ ok: true });
  });

  it.each<[string, readonly SimulatedStep[], string]>([
    [
      "a reverted step",
      [{ status: "reverted", gasUsed: 0n, transfers: [], approvals: [] }],
      "reverted",
    ],
    ["a bigger spend", [stepOf([out(coin, 2_051n), got()])], "other_amount"],
    ["less of the token than its minimum", [stepOf([out(), got(49_499n)])], "low_out"],
    ["another token in the wallet", [stepOf([out(), got(), got(1n, usd)])], "other_asset"],
  ])("refuses %s", (_case, steps, error) => {
    expect(checkLaunchEffects(steps, bounds)).toStrictEqual({ ok: false, error });
  });

  it("refuses an allowance the plan does not grant", () => {
    const approvals = [{ owner: wallet, spender: pad, amount: { asset: usd, base: 1n } }];
    const steps: SimulatedStep[] = [{ ...stepOf([out(), got()]), approvals }];
    expect(checkLaunchEffects(steps, bounds)).toStrictEqual({ ok: false, error: "other_approval" });
  });

  it("spends only the fee, and gets nothing, with no first buy", () => {
    const { firstBuy: _buy, minOutBase: _min, ...noBuy } = bounds;
    expect(checkLaunchEffects([stepOf([out(coin, 2_000n)])], noBuy)).toStrictEqual({
      ok: true,
      value: { spent: [{ asset: coin, base: 2_000n }], received: [] },
    });
  });
});
