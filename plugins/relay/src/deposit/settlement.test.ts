import { accountRefSchema, type SettlementCheck } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { relaySolver } from "../relay-chains.js";
import { bsc, depository } from "../testing/bridge-fixtures.js";
import {
  recordedBareTransferCheck,
  recordedFillCheck,
  recordedRefundCheck,
  recordedSolanaFillCheck,
} from "../testing/recorded-settlements.js";
import { relaySettlement } from "./settlement.js";

const depositories = { [bsc]: depository };
const parts = { depositories, solver: relaySolver };
const notOwn = { ok: false, error: "not_own" };
const settle = (check: SettlementCheck) => relaySettlement(check, parts);

describe("a Relay settlement matched by the chains' own events", () => {
  it("takes a Base fill as what Relay's solver sent the recipient in the delivered token", () => {
    expect(settle(recordedFillCheck)).toStrictEqual({ ok: true, value: 343_283n });
  });

  it("takes a Base fill as never more than the order's least output, so another order's share is left", () => {
    const minOut = { ...recordedFillCheck.minOut, base: 300_000n };
    expect(settle({ ...recordedFillCheck, minOut })).toStrictEqual({ ok: true, value: 300_000n });
  });

  it("takes a Solana fill whose memo names the deposit's order as all it paid", () => {
    expect(settle(recordedSolanaFillCheck)).toStrictEqual({ ok: true, value: 2n ** 64n - 1n });
  });

  it("takes a refund as what Relay's solver paid the wallet back, never more than sent", () => {
    expect(settle(recordedRefundCheck)).toStrictEqual({
      ok: true,
      value: 0x11_45_aa_2d_57_20_67_b8n,
    });
    const less = { ...recordedRefundCheck.amountIn, base: 1_000n };
    const deposited = recordedRefundCheck.deposit.events.map((event) => ({
      ...event,
      data: event.data.replace("114eb37716d305fa", "00000000000003e8"),
    }));
    const smaller = {
      ...recordedRefundCheck,
      amountIn: less,
      deposit: { ...recordedRefundCheck.deposit, events: deposited },
    };
    expect(settle(smaller)).toStrictEqual({ ok: true, value: 1_000n });
  });

  it("takes no transfer from anyone but Relay's solver", () => {
    expect(settle(recordedBareTransferCheck)).toStrictEqual(notOwn);
  });

  it("takes nothing for a deposit of another amount, wallet or token, or from another contract", () => {
    const wallet = accountRefSchema.parse(`${bsc}:0x${"55".repeat(20)}`);
    const amountIn = { ...recordedFillCheck.amountIn, base: recordedFillCheck.amountIn.base + 1n };
    expect(settle({ ...recordedFillCheck, wallet })).toStrictEqual(notOwn);
    expect(settle({ ...recordedFillCheck, amountIn })).toStrictEqual(notOwn);
    expect(
      relaySettlement(recordedFillCheck, { depositories: {}, solver: relaySolver }),
    ).toStrictEqual(notOwn);
  });

  it("takes no Solana fill whose memos name another order", () => {
    const events = recordedSolanaFillCheck.settlement.events.slice(1);
    const settlement = { ...recordedSolanaFillCheck.settlement, events };
    expect(settle({ ...recordedSolanaFillCheck, settlement })).toStrictEqual(notOwn);
  });

  it("takes no EVM fill that paid another recipient", () => {
    const recipient = accountRefSchema.parse(`eip155:8453:0x${"66".repeat(20)}`);
    expect(settle({ ...recordedFillCheck, recipient })).toStrictEqual(notOwn);
  });
});
