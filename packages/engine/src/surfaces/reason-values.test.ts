import { accountRefSchema } from "@binference/chain";
import { idSchema, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentHistory } from "../intents/intent-history.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { stakeQuoteDocument } from "../intents/stake-quote.js";
import { testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import { stakeRequest, testValidator } from "../staking/test-stakes.js";
import { testUnstakePlan } from "../venues/test-stake-steps.js";
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

const stakeIntent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const noneReady = { type: "choice", choice: "none" } as const;
const pool = accountRefSchema.parse("fake:1:0x000000e2");

// The history of a staking move whose last move's reason named what is given.
function endedNaming(named: { readonly [key: string]: JsonValue }): IntentHistory {
  const cause = { trigger: "check_failed", named } as const;
  return {
    events: [{ id: 1, intentId: stakeIntent, toState: "failed_check", cause, atMs: testNowMs }],
    cards: [],
  };
}

function namedValidator(name: string, account: typeof pool) {
  return {
    type: "line",
    line: {
      key: "card.value.validator",
      values: { moniker: { type: "text", text: name }, address: { type: "account", account } },
    },
  };
}

// A stake request that names no validator, as one to a liquid venue's pool is.
function poolRequest() {
  const { validator: _validator, ...request } = stakeRequest("unstake");
  return requestDocument.encode(request);
}

describe("the values a staking move's reason may name", () => {
  it("name the planned validator by its name once a plan named it", () => {
    const quote = stakeQuoteDocument.encode({ venue: "fake-staking", plan: testUnstakePlan });
    expect(reasonValuesOf({ kind: "stake", walletId: testWallet, quote })).toStrictEqual({
      wallet,
      validator: namedValidator("Active", testUnstakePlan.validator),
      readyAt: noneReady,
    });
  });

  it("name the requested validator by its account before any plan", () => {
    const request = requestDocument.encode(stakeRequest("stake"));
    expect(reasonValuesOf({ kind: "stake", walletId: testWallet, request })).toStrictEqual({
      wallet,
      validator: { type: "account", account: testValidator },
      readyAt: noneReady,
    });
  });

  it("name the least stake and when the next part is ready as the refusal named them", () => {
    const history = endedNaming({
      minStake: { asset: testCoin, base: "100" },
      readyAtMs: testNowMs + 60_000,
    });
    expect(reasonValuesOf({ kind: "stake", walletId: testWallet }, history)).toStrictEqual({
      wallet,
      min: { type: "amount", amount: { asset: testCoin, base: 100n } },
      readyAt: { type: "dateTime", atMs: testNowMs + 60_000 },
    });
  });

  it("name a liquid venue's pool the refusal named where the request names no validator", () => {
    const record = { kind: "stake", walletId: testWallet, request: poolRequest() } as const;
    const named = reasonValuesOf(record, endedNaming({ pool: { account: pool, name: "Lista" } }));
    const unnamed = reasonValuesOf(record, endedNaming({ pool: { account: pool } }));
    expect(named["validator"]).toStrictEqual(namedValidator("Lista", pool));
    expect(unnamed["validator"]).toStrictEqual({ type: "account", account: pool });
  });

  it("name no validator when neither a plan, a request nor the refusal names one", () => {
    expect(reasonValuesOf({ kind: "stake", walletId: testWallet })).toStrictEqual({
      wallet,
      readyAt: noneReady,
    });
  });
});
