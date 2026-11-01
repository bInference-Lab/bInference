import { accountRefSchema, assetRefSchema } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { spokePools } from "../testing/bridge-fixtures.js";
import {
  recordedBareTransferCheck,
  recordedFillCheck as fill,
  recordedRefundCheck as refund,
  recordedRefundDepositEvents,
  recordedRefundEvents,
} from "../testing/recorded-settlements.js";
import { acrossSettlement } from "./settlement.js";

const arbitrum = fill.settlement.ref.chain;
const bsc = fill.deposit.ref.chain;

describe("matching a settlement to its own deposit", () => {
  it("reads what a fill paid from its FilledRelay of the deposit's id, origin and recipient", () => {
    expect(acrossSettlement(fill, spokePools)).toStrictEqual({ ok: true, value: 288_148_284n });
  });

  it.each([
    ["a bare transfer to the recipient, with no fill event", recordedBareTransferCheck],
    [
      "a fill of another deposit to the same recipient",
      { ...fill, deposit: { ...fill.deposit, events: recordedRefundDepositEvents } },
    ],
    [
      "a fill for another recipient",
      { ...fill, recipient: accountRefSchema.parse(`${arbitrum}:0x${"22".repeat(20)}`) },
    ],
    ["a deposit of another amount", { ...fill, amountIn: { ...fill.amountIn, base: 1n } }],
    [
      "a deposit from another wallet",
      { ...fill, wallet: accountRefSchema.parse(`${bsc}:0x${"33".repeat(20)}`) },
    ],
    [
      "a fill in another token than the route's",
      {
        ...fill,
        minOut: {
          ...fill.minOut,
          asset: assetRefSchema.parse(`${arbitrum}/erc20:0x${"44".repeat(20)}`),
        },
      },
    ],
    [
      "a fill whose SpokePool the bridge does not know",
      {
        ...fill,
        settlement: {
          ...fill.settlement,
          ref: { ...fill.settlement.ref, chain: fill.deposit.ref.chain },
        },
      },
    ],
  ])("is not own for %s", (_case, check) => {
    expect(acrossSettlement(check, spokePools)).toStrictEqual({ ok: false, error: "not_own" });
  });

  it("pays back the deposit's input alone from a leaf that sums the depositor's refunds", () => {
    expect(acrossSettlement(refund, spokePools)).toStrictEqual({
      ok: true,
      value: 59_462_062_799_438_419n,
    });
  });

  it("is not own for refund leaves of the deposit's token that pay other addresses only", () => {
    const leaves = { ...refund.settlement, events: recordedRefundEvents };
    const check = { ...fill, kind: "refund" as const, settlement: leaves };
    expect(acrossSettlement(check, spokePools)).toStrictEqual({ ok: false, error: "not_own" });
  });

  it("is not own for a refund read as a fill", () => {
    expect(acrossSettlement({ ...refund, kind: "fill" }, spokePools)).toStrictEqual({
      ok: false,
      error: "not_own",
    });
  });
});
