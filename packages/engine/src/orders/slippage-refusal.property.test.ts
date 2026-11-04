import { type AssetRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { BuyRequest, SellRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testLimits, testToken, testWallet } from "../intents/test-intents.js";
import { swapSubjectOf, swapTradeOf, tradeAskOf } from "../money-path/swap-trade.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { type PolicyFacts, policyRefusals } from "../policy/policy-rules.js";
import { slippageRefusal } from "./slippage-refusal.js";

const chains = testChains();
const registered = chains.get(chainRefSchema.parse("fake:1"));
if (!registered.ok) {
  throw new Error("Expected the fake chain in the test registry.");
}
const chain = registered.value;
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const status = { kind: "buy", isPaper: true, hasOutsideContent: false } as const;
const bps = fc.integer({ min: 0, max: 10_000 }).map((value) => value as Bps);

// The facts a fill's policy reads, with only the slippage limits drawn: no other rule refuses.
function factsOf(registry: Bps, other: Bps): PolicyFacts {
  return {
    isFrozen: false,
    limits: {
      perTradeCapUsdMicros: 10n ** 12n,
      rollingDayCapUsdMicros: 10n ** 12n,
      maxSlippageBps: { registry, other },
      gasReserveBase: 0n,
      venues: [],
      allowTokens: [],
      denyTokens: [],
    },
    sendLevel: 0,
    addressBook: [],
    nativeAsset: testCoin,
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    recentOutflows: [],
  };
}

// The buy or sale one fill of the order asks, as `fill-request.ts` writes it.
function fillOf(side: "buy" | "sell", token: AssetRef, maxSlippageBps: Bps) {
  const reason = "The order's trigger fired.";
  const base = { agent: testAgent, wallet: testWallet, token, reason, maxSlippageBps };
  const buy: BuyRequest = { ...base, kind: "buy", spend: { asset: testCoin, base: 1_000n } };
  const sale: SellRequest = { ...base, kind: "sell", amount: { base: 1_000n } };
  return side === "buy" ? buy : sale;
}

// Whether the fill's policy refuses it for its slippage, on the pair the money path resolves.
function fillRefusedForSlippage(fill: BuyRequest | SellRequest, facts: PolicyFacts): boolean {
  const limits = {
    ...testLimits,
    slippageRegistryBps: facts.limits.maxSlippageBps.registry,
    slippageOtherBps: facts.limits.maxSlippageBps.other,
  };
  const ask = tradeAskOf(fill, { limits, chains });
  if (!ask.ok) {
    throw new Error(`Expected a trade, got ${ask.error}.`);
  }
  const terms = { amountInBase: 1_000n, assetOut: ask.value.assetOut ?? testCoin, venues: [] };
  const trade = swapTradeOf(ask.value, terms, { limits, account: testAccount, chains });
  const subject = swapSubjectOf(trade, status);
  return policyRefusals({ subject, facts, nowMs: 0 }).includes("slippage");
}

describe("the slippage refusal of a new order or rule", () => {
  it("refuses exactly what the policy refuses at each of its fills", () => {
    fc.assert(
      fc.property(
        fc.record({
          registry: bps,
          other: bps,
          asked: bps,
          side: fc.constantFrom("buy" as const, "sell" as const),
          token: fc.constantFrom(testToken, unlisted),
        }),
        ({ registry, other, asked, side, token }) => {
          const facts = factsOf(registry, other);
          const limits = { ...testLimits, slippageRegistryBps: registry, slippageOtherBps: other };
          const asking = { token, maxSlippageBps: asked, isCopy: false };
          const refused = slippageRefusal(asking, { limits, chain, chains }) !== undefined;
          expect(refused).toBe(fillRefusedForSlippage(fillOf(side, token, asked), facts));
        },
      ),
    );
  });

  it("refuses a copy order only when its fills of any token would all be refused", () => {
    fc.assert(
      fc.property(fc.record({ registry: bps, other: bps, asked: bps }), (drawn) => {
        const { registry, other, asked } = drawn;
        const facts = factsOf(registry, other);
        const limits = { ...testLimits, slippageRegistryBps: registry, slippageOtherBps: other };
        const asking = { token: testCoin, maxSlippageBps: asked, isCopy: true };
        const refused = slippageRefusal(asking, { limits, chain, chains }) !== undefined;
        const fills = [testToken, unlisted].map((token) => fillOf("buy", token, asked));
        expect(refused).toBe(fills.every((fill) => fillRefusedForSlippage(fill, facts)));
      }),
    );
  });
});
