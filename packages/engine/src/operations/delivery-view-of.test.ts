import { accountRefSchema, chainRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { BridgeRecord } from "../bridges/bridge-record.js";
import { testCoin, testNowMs } from "../intents/test-intents.js";
import { deliveryOf } from "./delivery-view-of.js";

const signal = new AbortController().signal;
const id = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const recipient = accountRefSchema.parse("fake:2:0x000000e1");
const sent = { asset: testCoin, base: 1_000n };

function txHash(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new Error(`Expected a transaction hash, got ${text}.`);
  }
  return text;
}

// A bridge the follower found paid back to its wallet after it went late.
const refunded: BridgeRecord = {
  intentId: id,
  venue: "fake-bridge",
  depositTx: txHash("0xdeposit"),
  toChain: chainRefSchema.parse("fake:2"),
  recipient,
  sent,
  minOut: sent,
  statusUrl: "https://bridge.example.invalid/tx/0xdeposit",
  sentAtMs: testNowMs,
  state: "refunded",
  lateAtMs: testNowMs + 7_200_000,
  refundTx: txHash("0xrefund"),
  received: sent,
  settledAtMs: testNowMs + 7_300_000,
  version: 3,
};

const bridges = { get: async () => Promise.resolve(refunded) };

describe("a bridge intent's delivery view", () => {
  it("shows a refund with its transaction, the venue's page, and when it went late and settled", async () => {
    await expect(deliveryOf(bridges, { id, kind: "bridge" }, signal)).resolves.toStrictEqual({
      state: "refunded",
      toChain: refunded.toChain,
      recipient,
      minOut: sent,
      received: sent,
      refundTx: "0xrefund",
      statusUrl: "https://bridge.example.invalid/tx/0xdeposit",
      sentAt: testNowMs,
      lateAt: testNowMs + 7_200_000,
      settledAt: testNowMs + 7_300_000,
    });
  });

  it("shows none for another kind of intent, or where no bridge store is read", async () => {
    await expect(deliveryOf(bridges, { id, kind: "send" }, signal)).resolves.toBeUndefined();
    await expect(deliveryOf(undefined, { id, kind: "bridge" }, signal)).resolves.toBeUndefined();
  });
});
