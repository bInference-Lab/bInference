import { type AssetRef, assetRefSchema, canonicalAsset, chainRefSchema } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../agents/agent-record.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft, testCoin, testSwap } from "../intents/test-intents.js";
import { testAccount, testChains, testFacts } from "../operations/test-engine.js";
import { policyRefusals, sellsDeniedToken } from "../policy/policy-rules.js";
import { policyFactsOf } from "./policy-facts-of.js";
import { swapSubjectOf, swapTradeOf } from "./swap-trade.js";

const chains = testChains();
const live = { signal: new AbortController().signal };
const status = { kind: "swap", isPaper: true, hasOutsideContent: false } as const;

async function settingsOf(): Promise<AgentSettings> {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live);
  const settings = await agents.get(testAgent, live);
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  return settings;
}

const settings = await settingsOf();

// One fake token address, and two spellings of it that differ only in letter case.
const caseMask = fc.integer({ min: 0, max: 255 });
const spellings = fc
  .tuple(fc.stringMatching(/^[0-9a-f]{8}$/), caseMask, caseMask)
  .map(
    ([digits, first, second]: readonly [string, number, number]): readonly [AssetRef, AssetRef] => [
      spell(digits, first),
      spell(digits, second),
    ],
  );

// The token at `digits`, each digit whose bit is set in `mask` in upper case.
function spell(digits: string, mask: number): AssetRef {
  const spelled = digits.replaceAll(/./g, (digit, at: number) =>
    ((mask >> at) & 1) === 1 ? digit.toUpperCase() : digit,
  );
  return assetRefSchema.parse(`fake:1/token:0x${spelled}`);
}

// The policy's refusals and mark for a swap of `from` into `to`, with the lists the owner wrote.
function judged(
  swap: { readonly from: AssetRef; readonly to: AssetRef },
  lists: { readonly allowTokens: readonly AssetRef[]; readonly denyTokens: readonly AssetRef[] },
) {
  const limits = { ...settings.limits, ...lists };
  const agent = { ...settings, limits };
  const trade = swapTradeOf(testSwap(swap), { limits, account: testAccount, chains });
  if (!trade.ok) {
    throw new Error(`Expected a trade, got ${trade.error}.`);
  }
  const facts = policyFactsOf({
    settings: agent,
    wallet: testFacts,
    chain: chainRefSchema.parse("fake:1"),
    chains,
    nativeAsset: testCoin,
    nowMs: 0,
  });
  const input = { subject: swapSubjectOf(trade.value, status), facts, nowMs: 0 };
  return { refusals: policyRefusals(input), sellsDenied: sellsDeniedToken(input) };
}

describe("the token lists and the spelling of a token", () => {
  it("give every spelling of one token the same canonical form", () => {
    fc.assert(
      fc.property(spellings, ([first, second]) => {
        expect(canonicalAsset(chains, first)).toStrictEqual(canonicalAsset(chains, second));
      }),
    );
  });

  it("deny a buy, mark a sale and allow a trade however the owner and the request spell it", () => {
    fc.assert(
      fc.property(spellings, ([listed, asked]) => {
        const deny = { allowTokens: [], denyTokens: [listed] };
        expect(judged({ from: testCoin, to: asked }, deny).refusals).toContain("token_denied");
        const sale = judged({ from: asked, to: testCoin }, deny);
        expect([sale.refusals.includes("token_denied"), sale.sellsDenied]).toStrictEqual([
          false,
          true,
        ]);
        const allow = { allowTokens: [listed], denyTokens: [] };
        expect(judged({ from: testCoin, to: asked }, allow).refusals).not.toContain("token_denied");
      }),
    );
  });
});
