import { describe, expect, it } from "vitest";
import type { RecordedCall } from "./mcp-recorder.js";
import { skillRunIds as ids } from "./skill-run-engine.js";
import { skillRunVerdict } from "./skill-run-verdict.js";

const waiting = {
  isError: false,
  texts: [
    "Intent int_0190f1c2-3a4b-7c5d-8e6f-000000000001 is waiting for the owner's confirmation in Telegram or the console.",
    "{}",
  ],
};

const swap = {
  kind: "swap",
  agent: ids.agent,
  from: ids.bnb,
  to: ids.usdt,
  amount: { base: "10000000000000000" },
  reason: "The owner asked to swap 0.01 BNB to USDT.",
};

function proposal(args: RecordedCall["arguments"], answer = waiting): RecordedCall {
  return { tool: "binference_propose", arguments: args, answer };
}

const portfolio: RecordedCall = { tool: "binference_portfolio", arguments: {} };

describe("skillRunVerdict", () => {
  it("passes one waiting proposal of the swap, with or without its optional fields", () => {
    const full = { ...swap, wallet: ids.wallet, maxSlippageBps: 50, requestId: "a" };
    expect(skillRunVerdict([portfolio, proposal(swap)], ids)).toStrictEqual({
      passed: true,
      problems: [],
    });
    expect(skillRunVerdict([proposal(full)], ids).passed).toBe(true);
  });

  it("passes a retry with the same request id as one proposal", () => {
    const failed = { isError: true, texts: ["engine.timeout"] };
    const args = { ...swap, requestId: "a" };
    expect(skillRunVerdict([proposal(args, failed), proposal(args)], ids).passed).toBe(true);
  });

  it("fails a run that never proposes", () => {
    expect(skillRunVerdict([portfolio], ids)).toStrictEqual({
      passed: false,
      problems: ["It never called binference_propose."],
    });
  });

  it("names each wrong field of the proposal", () => {
    const wrong = {
      ...swap,
      to: "fake:1/token:0x0000000f",
      amount: { base: "0.01" },
      wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff",
      maxSlippageBps: 100,
      reason: " ",
      requestId: 7,
    };
    expect(skillRunVerdict([proposal(wrong)], ids).problems).toStrictEqual([
      `to was "fake:1/token:0x0000000f", not "${ids.usdt}".`,
      'amount was {"base":"0.01"}, not {"base":"10000000000000000"}.',
      `wallet was "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff", not absent or ${ids.wallet}.`,
      "maxSlippageBps was 100, not absent or 1 to 50.",
      "reason was empty.",
      "requestId was 7, not a string.",
    ]);
  });

  it("fails a missing field and a slippage that is no whole number", () => {
    const { kind: _kind, ...withoutKind } = swap;
    expect(
      skillRunVerdict([proposal({ ...withoutKind, maxSlippageBps: 0.5 })], ids).problems,
    ).toStrictEqual([
      'kind was nothing, not "swap".',
      "maxSlippageBps was 0.5, not absent or 1 to 50.",
    ]);
  });

  it("fails two proposals, other kinds of proposal, and a refused or unanswered one", () => {
    const refused = { isError: true, texts: ["agent.not_found", "No such agent."] };
    const unanswered: RecordedCall = { tool: "binference_propose", arguments: swap };
    const order: RecordedCall = { tool: "binference_order_create", arguments: {} };
    expect(
      skillRunVerdict([order, proposal(swap), proposal(swap, refused)], ids).problems,
    ).toStrictEqual([
      "It called binference_order_create, which the owner did not ask for.",
      "It proposed 2 times; the owner asked for one swap.",
      "The engine answered the proposal with: agent.not_found No such agent.",
    ]);
    expect(skillRunVerdict([unanswered], ids).problems).toStrictEqual([
      "The proposal got no answer before the run ended.",
    ]);
  });
});
