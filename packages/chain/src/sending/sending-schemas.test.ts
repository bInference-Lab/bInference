import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type RelayAnswer, relayAnswerSchema, relayRefusals } from "./relay-answer.js";
import { type TxReceipt, txReceiptSchema } from "./tx-receipt.js";

const answers: readonly RelayAnswer[] = [
  { relay: "club48", outcome: "accepted", atMs: 1 },
  ...relayRefusals.map((reason): RelayAnswer => ({
    relay: "bsc.blockrazor.xyz",
    outcome: "refused",
    reason,
    atMs: 2,
  })),
  { relay: "blockrazor", outcome: "refused", reason: "gas_quota", code: 4802, atMs: 3 },
  { relay: "pancakeswap-mev-guard", outcome: "timed_out", atMs: 4 },
  { relay: "relay-b", outcome: "unreachable", atMs: 5 },
];

const receipt: TxReceipt = {
  hash: "0xabc" as TxReceipt["hash"],
  block: { number: 2n ** 64n + 1n, hash: "0xdef" },
  status: "reverted",
  gasUsed: 21_000n,
  feePerGasBase: 50_000_000n,
};

describe("the sending schemas", () => {
  it.each(answers)("reads back a relay answer: $outcome", (answer) => {
    expect(relayAnswerSchema.parse(structuredClone(answer))).toStrictEqual(answer);
  });

  it.each([
    { relay: "Club48", outcome: "accepted", atMs: 1 },
    { relay: "club48", outcome: "refused", reason: "too_slow", atMs: 1 },
    { relay: "club48", outcome: "accepted", atMs: 1, reason: "rejected" },
    { relay: "-club48", outcome: "timed_out", atMs: 1 },
  ])("refuses a malformed relay answer %#", (answer: Readonly<Record<string, unknown>>) => {
    expect(relayAnswerSchema.safeParse(answer).success).toBe(false);
  });

  it("carries a receipt as JSON with its numbers as decimal strings", () => {
    const wire = z.encode(txReceiptSchema, receipt);
    expect(wire).toStrictEqual({
      hash: "0xabc",
      block: { number: "18446744073709551617", hash: "0xdef" },
      status: "reverted",
      gasUsed: "21000",
      feePerGasBase: "50000000",
    });
    expect(z.decode(txReceiptSchema, wire)).toStrictEqual(receipt);
    expect(txReceiptSchema.safeParse({ ...wire, status: "pending" }).success).toBe(false);
  });
});
