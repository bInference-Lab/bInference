import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import { reasonValuesOf } from "./reason-values.js";

const payee = accountRefSchema.parse("fake:1:0x000000e1");
const amount = { asset: testCoin, base: 1n };
const wallet = { type: "text", text: testWallet } as const;

const bridgeQuote = bridgeQuoteDocument.encode({
  venue: "fake-bridge",
  chainName: "Base",
  amount,
  recipient: payee,
  recipientBytes: "0x01",
  expectedOut: amount,
  minOut: amount,
  fees: [],
  etaSeconds: 60,
  quotedAtMs: testNowMs,
  expiresAtMs: testNowMs + 60_000,
  deposit: { kind: "bound", contract: payee, destinationId: "8453" },
});

describe("the values a reason's words may name", () => {
  it("name the wallet of an intent with no quote yet", () => {
    expect(reasonValuesOf({ kind: "swap", walletId: testWallet })).toStrictEqual({ wallet });
  });

  it("name a bridge's destination chain as the registry names it", () => {
    const record = { kind: "bridge", walletId: testWallet, quote: bridgeQuote } as const;
    expect(reasonValuesOf(record)).toStrictEqual({
      wallet,
      chain: { type: "text", text: "Base" },
    });
  });

  it("name a send by name's name, and nothing more for a send to an address", () => {
    const sent = { amount, recipient: payee, quotedAtMs: testNowMs };
    const byName = sendQuoteDocument.encode({
      ...sent,
      name: { name: "alice.bnb", resolvedAtMs: testNowMs },
    });
    const byAddress = sendQuoteDocument.encode(sent);
    expect(reasonValuesOf({ kind: "send", walletId: testWallet, quote: byName })).toStrictEqual({
      wallet,
      name: { type: "text", text: "alice.bnb" },
    });
    expect(reasonValuesOf({ kind: "send", walletId: testWallet, quote: byAddress })).toStrictEqual({
      wallet,
    });
  });
});
