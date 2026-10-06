import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intentKinds } from "../intents/intent-kind.js";
import {
  type PolicyReason,
  type PolicyRejection,
  policyReasons,
} from "../intents/intent-reason.js";
import {
  type AddressBookEntry,
  type PolicyFacts,
  type PolicyFigures,
  type PolicyInput,
  policyRefusals,
  type PolicySubject,
} from "./policy-rules.js";

const nowMs = 1_800_000_000_000;
const coin = "fake:1/slip44:1" as AssetRef;
const assets = [coin, "fake:1/token:a", "fake:1/token:b", "fake:1/token:c"] as AssetRef[];
const accounts = ["fake:1:a", "fake:1:b", "fake:1:c", "fake:1:d"] as AccountRef[];
const venues = ["venue-a", "venue-b", "venue-c"];

// Small ranges put caps, values and balances on each other's boundaries often.
const small = fc.bigInt({ min: 0n, max: 400n });
const bps = fc.integer({ min: 0, max: 10_000 }).map((value) => value as Bps);
const near = fc.integer({ min: nowMs - 2, max: nowMs + 2 });

const subjects: fc.Arbitrary<PolicySubject> = fc.record(
  {
    // Sends and bridges carry the most rules, so they come up as often as every other kind.
    kind: fc.oneof(
      fc.constantFrom(...intentKinds),
      fc.constantFrom("send" as const, "bridge" as const),
    ),
    isPaper: fc.boolean(),
    hasOutsideContent: fc.boolean(),
    outflows: fc.array(fc.record({ asset: fc.constantFrom(...assets), base: small }), {
      maxLength: 3,
    }),
    tokens: fc.subarray(assets),
    venue: fc.constantFrom(...venues),
    slippage: fc.record({ bps, isRegistryPair: fc.boolean() }),
    target: fc.constantFrom(...accounts),
  },
  { requiredKeys: ["kind", "isPaper", "hasOutsideContent", "outflows", "tokens"] },
);

const entries: fc.Arbitrary<readonly AddressBookEntry[]> = fc.uniqueArray(
  fc.record({ account: fc.constantFrom(...accounts), isSaved: fc.boolean(), usableAtMs: near }),
  { selector: (entry) => entry.account, maxLength: 4 },
);

const factsArbitrary: fc.Arbitrary<PolicyFacts> = fc.record(
  {
    isFrozen: fc.boolean(),
    limits: fc.record({
      perTradeCapUsdMicros: small,
      rollingDayCapUsdMicros: small,
      maxSlippageBps: fc.record({ registry: bps, other: bps }),
      maxTaxBps: bps,
      gasReserveBase: small,
      venues: fc.subarray(venues),
      allowTokens: fc.oneof(fc.constant([]), fc.subarray(assets)),
      denyTokens: fc.subarray(assets),
    }),
    sendLevel: fc.constantFrom(0, 1, 2, 3),
    addressBook: entries,
    rescueAccount: fc.constantFrom(...accounts),
    nativeAsset: fc.constant(coin),
    nativeBalanceBase: small,
    ceilingPerTxNativeBase: small,
    knownTaxBps: bps,
    recentOutflows: fc.constant([]),
  },
  {
    requiredKeys: [
      "isFrozen",
      "limits",
      "sendLevel",
      "addressBook",
      "nativeAsset",
      "nativeBalanceBase",
      "ceilingPerTxNativeBase",
      "recentOutflows",
    ],
  },
);

interface Generated {
  readonly subject: PolicySubject;
  readonly facts: PolicyFacts;
  readonly figures: PolicyFigures | undefined;
}

function inputOf({ figures, ...rest }: Generated): PolicyInput {
  return figures === undefined ? { ...rest, nowMs } : { ...rest, nowMs, figures };
}

const inputs: fc.Arbitrary<PolicyInput> = fc
  .record({
    subject: subjects,
    facts: factsArbitrary,
    figures: fc.option(fc.record({ valueUsdMicros: small, rollingDaySpentUsdMicros: small }), {
      nil: undefined,
    }),
  })
  .map(inputOf);

type Earned = Readonly<Partial<Record<PolicyReason, boolean>>>;

const liveOnly: ReadonlySet<string> = new Set(["send", "bridge", "cexOrder", "registerIdentity"]);

function nativeOut(outflows: readonly Amount[]): bigint {
  return outflows.reduce((sum, item) => sum + (item.asset === coin ? item.base : 0n), 0n);
}

function isSend({ subject }: PolicyInput): boolean {
  return subject.kind === "send" || subject.kind === "bridge";
}

function savedEntry({ subject, facts }: PolicyInput): AddressBookEntry | undefined {
  return facts.addressBook.find((entry) => entry.isSaved && entry.account === subject.target);
}

function paysRescue({ subject, facts }: PolicyInput): boolean {
  return facts.rescueAccount !== undefined && subject.target === facts.rescueAccount;
}

function capPassViolations({ facts, figures }: PolicyInput): readonly string[] {
  if (figures === undefined) {
    return ["passed without a price"];
  }
  const { perTradeCapUsdMicros, rollingDayCapUsdMicros } = facts.limits;
  return [
    figures.valueUsdMicros > perTradeCapUsdMicros ? "passed over the per-trade cap" : "",
    figures.rollingDaySpentUsdMicros + figures.valueUsdMicros > rollingDayCapUsdMicros
      ? "passed over the 24-hour cap"
      : "",
  ];
}

function walletPassViolations({ subject, facts }: PolicyInput): readonly string[] {
  const spent = nativeOut(subject.outflows);
  return [
    facts.isFrozen ? "passed while frozen" : "",
    spent > 0n && facts.nativeBalanceBase - spent < facts.limits.gasReserveBase
      ? "passed into the gas reserve"
      : "",
    subject.kind !== "send" && spent > facts.ceilingPerTxNativeBase
      ? "passed over the ceiling"
      : "",
  ];
}

function sendPassViolations(input: PolicyInput): readonly string[] {
  if (!isSend(input)) {
    return [];
  }
  const entry = savedEntry(input);
  const isUsable =
    entry !== undefined && (input.facts.sendLevel !== 2 || entry.usableAtMs <= nowMs);
  return [
    input.facts.sendLevel === 3 ? "sent at level 3" : "",
    paysRescue(input) || isUsable ? "" : "sent where the send level and the book forbid",
  ];
}

// The limits the policy must hold for any intent it lets through: the caps, the gas reserve, the
// ceiling and the send level with the address book.
function passViolations(input: PolicyInput): readonly string[] {
  return [
    ...capPassViolations(input),
    ...walletPassViolations(input),
    ...sendPassViolations(input),
  ].filter((text) => text !== "");
}

function isListed(token: AssetRef, facts: PolicyFacts): boolean {
  const { allowTokens, denyTokens } = facts.limits;
  return !denyTokens.includes(token) && (allowTokens.length === 0 || allowTokens.includes(token));
}

function capsEarned({ facts, figures }: PolicyInput): Earned {
  const { perTradeCapUsdMicros, rollingDayCapUsdMicros } = facts.limits;
  return {
    per_trade_cap: figures !== undefined && figures.valueUsdMicros > perTradeCapUsdMicros,
    daily_cap:
      figures !== undefined &&
      figures.valueUsdMicros + figures.rollingDaySpentUsdMicros > rollingDayCapUsdMicros,
    no_price: figures === undefined,
  };
}

function walletEarned({ subject, facts }: PolicyInput): Earned {
  const spent = nativeOut(subject.outflows);
  return {
    frozen: facts.isFrozen,
    paper_only: subject.isPaper && liveOnly.has(subject.kind),
    ceiling: subject.kind !== "send" && spent > facts.ceilingPerTxNativeBase,
    gas_reserve: spent > 0n && spent + facts.limits.gasReserveBase > facts.nativeBalanceBase,
  };
}

function tradeEarned({ subject, facts }: PolicyInput): Earned {
  const { limits } = facts;
  const slippageLimit =
    subject.slippage?.isRegistryPair === true
      ? limits.maxSlippageBps.registry
      : limits.maxSlippageBps.other;
  return {
    slippage: subject.slippage !== undefined && subject.slippage.bps > slippageLimit,
    tax: facts.knownTaxBps !== undefined && facts.knownTaxBps > limits.maxTaxBps,
    venue_off: subject.venue !== undefined && !limits.venues.includes(subject.venue),
    token_denied: subject.tokens.some((token) => token !== coin && !isListed(token, facts)),
  };
}

function isCooling(input: PolicyInput): boolean {
  const entry = savedEntry(input);
  return (
    input.facts.sendLevel === 2 &&
    !paysRescue(input) &&
    entry !== undefined &&
    entry.usableAtMs > nowMs
  );
}

function sendEarned(input: PolicyInput): Earned {
  if (!isSend(input)) {
    return {};
  }
  const isKnown = paysRescue(input);
  const inBook = input.facts.addressBook.some((entry) => entry.account === input.subject.target);
  return {
    send_level: input.facts.sendLevel === 3 || isCooling(input),
    unsaved_address: !isKnown && savedEntry(input) === undefined,
    outside_content_send: input.subject.hasOutsideContent && !isKnown && !inBook,
  };
}

// Spec 6, section 4, restated from the spec: which reasons an intent earns.
function expectedReasons(input: PolicyInput): readonly PolicyRejection[] {
  const earned: Earned = {
    ...capsEarned(input),
    ...walletEarned(input),
    ...tradeEarned(input),
    ...sendEarned(input),
  };
  return policyReasons.filter(
    (reason): reason is PolicyRejection => reason !== "price_impact" && earned[reason] === true,
  );
}

function rescueReasons(input: PolicyInput): readonly PolicyRejection[] {
  return [
    ...(input.subject.isPaper ? ["paper_only" as const] : []),
    ...(paysRescue(input) ? [] : ["unsaved_address" as const]),
  ];
}

function reasonsFor(input: PolicyInput): readonly PolicyRejection[] {
  return input.subject.kind === "rescue" ? rescueReasons(input) : expectedReasons(input);
}

// An intent the rules let through, with what it broke; one they refuse breaks nothing here.
function violationsOfPass(input: PolicyInput): readonly string[] {
  return policyRefusals(input).length > 0 ? [] : passViolations(input);
}

const rescueAccount = "fake:1:rescue" as AccountRef;

// A live rescue that pays the rescue address, whatever else holds.
function asLiveRescue(input: PolicyInput): PolicyInput {
  return {
    ...input,
    subject: { ...input.subject, kind: "rescue", isPaper: false, target: rescueAccount },
    facts: { ...input.facts, rescueAccount },
  };
}

const rescues: fc.Arbitrary<PolicyInput> = inputs.map(asLiveRescue);

describe("the policy rules", () => {
  it("let no intent past a cap, the gas reserve, the ceiling or a send level", () => {
    const intents = inputs.filter((input) => input.subject.kind !== "rescue");
    fc.assert(
      fc.property(intents, (input) => {
        expect(violationsOfPass(input)).toStrictEqual([]);
      }),
      { numRuns: 2_000 },
    );
  });

  it("name every rule an intent breaks, in spec order, and no other", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        expect(policyRefusals(input)).toStrictEqual(reasonsFor(input));
      }),
      { numRuns: 2_000 },
    );
  });

  it("let a live rescue to the rescue address through a freeze, any send level and any cap", () => {
    fc.assert(
      fc.property(rescues, (input) => {
        expect(policyRefusals(input)).toStrictEqual([]);
      }),
    );
  });
});
