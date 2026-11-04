import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { BridgeRecord } from "../bridges/bridge-record.js";
import { type BridgeIntentQuote, bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { bridgeReceiptOf } from "./bridge-receipt.js";

const live = { signal: new AbortController().signal };

function txHash(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new Error(`Expected a transaction hash, got ${text}.`);
  }
  return text;
}

const depositTx = txHash("0xdeposit");
const fillTx = txHash("0xfill");
const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const payee = accountRefSchema.parse("fake:2:0x000000e1");
const amount = { asset: testCoin, base: 1_000n };
const delivered = { asset: assetRefSchema.parse("fake:2/slip44:1"), base: 990n };

const quote: BridgeIntentQuote = {
  venue: "fake-bridge",
  chainName: "Base",
  amount,
  recipient: payee,
  recipientBytes: "0x01",
  expectedOut: delivered,
  minOut: delivered,
  fees: [],
  etaSeconds: 90,
  quotedAtMs: testNowMs,
  expiresAtMs: testNowMs + 60_000,
  deposit: { kind: "bound", contract: payee, destinationId: "2" },
};

// A live bridge's intent in the state given, with the quote given.
function bridgeIntent(
  state: IntentRecord["state"],
  bridged: BridgeIntentQuote = quote,
): IntentRecord {
  return {
    id: intentId,
    agentId: testAgent,
    walletId: testWallet,
    kind: "bridge",
    state,
    request: {},
    quote: bridgeQuoteDocument.encode(bridged),
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 6,
  };
}

// The bridge's row as the follower keeps it, in the state given.
function bridgeRow(change: Partial<BridgeRecord>): BridgeRecord {
  return {
    intentId,
    venue: "fake-bridge",
    depositTx,
    toChain: chainRefSchema.parse("fake:2"),
    recipient: payee,
    sent: amount,
    minOut: delivered,
    sentAtMs: testNowMs,
    state: "in_transit",
    version: 1,
    ...change,
  };
}

// The receipt of the bridge's intent, with its row and the transactions given, on the test chains.
async function receiptOf(
  record: IntentRecord,
  row: BridgeRecord | undefined,
  sent: readonly TransactionRecord[] = [],
) {
  return bridgeReceiptOf(
    {
      record,
      transactions: { ofIntent: async () => Promise.resolve(sent) },
      chains: testChains(),
      bridges: { get: async () => Promise.resolve(row) },
      install: { read: async () => Promise.reject(new Error("The receipt read the wallets.")) },
    },
    live,
  );
}

describe("a bridge's receipt read from its rows", () => {
  it("names the saved label and the rescue address a delivery paid", async () => {
    const record = bridgeIntent("reconciled", { ...quote, label: "Cold", isRescue: true });
    const row = bridgeRow({ state: "delivered", fillTx, received: delivered });
    const receipt = await receiptOf(record, row);
    expect(receipt?.outcome).toMatchObject({
      kind: "bridgeDelivered",
      chain: "Base",
      payee: { label: "Cold", isRescue: true },
      received: delivered,
    });
  });

  it("names the source chain by its reference when the registry lacks it", async () => {
    const elsewhere = { asset: assetRefSchema.parse("fake:9/slip44:1"), base: 1_000n };
    const record = bridgeIntent("finalized", { ...quote, amount: elsewhere });
    const receipt = await receiptOf(record, bridgeRow({}));
    expect(receipt?.outcome).toStrictEqual({
      kind: "bridgeSent",
      fromChain: "fake:9",
      chain: "Base",
      minutes: 2,
      tx: { hash: depositTx },
    });
  });

  it("shows nothing while neither a deposit row nor a transaction is stored", async () => {
    await expect(receiptOf(bridgeIntent("finalized"), undefined)).resolves.toBeUndefined();
  });

  it("shows nothing for a settled bridge whose settlement is not stored", async () => {
    const record = bridgeIntent("reconciled");
    const unread = bridgeRow({ state: "delivered", fillTx });
    const noRefundTx = bridgeRow({ state: "refunded", received: amount });
    await expect(receiptOf(record, unread)).resolves.toBeUndefined();
    await expect(receiptOf(record, noRefundTx)).resolves.toBeUndefined();
    await expect(receiptOf(record, undefined)).resolves.toBeUndefined();
  });
});
