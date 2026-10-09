import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AutoModeFacts, type AutoModeSubject, checkAutoMode } from "../intents/auto-mode.js";
import { intentKinds } from "../intents/intent-kind.js";
import {
  type PolicyReason,
  type PolicyRejection,
  policyReasons,
} from "../intents/intent-reason.js";
import type { IntentStatus } from "../intents/intent-status.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import {
  type AddressBookEntry,
  type PolicyFacts,
  type PolicyFigures,
  type PolicyInput,
  policyRefusals,
  type PolicySubject,
  sellsDeniedToken,
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
    inflowAssets: fc.subarray(assets),
    venue: fc.constantFrom(...venues),
    slippage: fc.record({ bps, isRegistryPair: fc.boolean() }),
    target: fc.constantFrom(...accounts),
  },
  { requiredKeys: ["kind", "isPaper", "hasOutsideContent", "outflows", "inflowAssets"] },
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

function isDenied(token: AssetRef, { facts }: PolicyInput): boolean {
  return token !== coin && facts.limits.denyTokens.includes(token);
}

function sellsDenied(input: PolicyInput): boolean {
  return input.subject.outflows.some((item) => isDenied(item.asset, input));
}

function receivesDenied(input: PolicyInput): boolean {
  return input.subject.inflowAssets.some((token) => isDenied(token, input));
}

// A denied token may leave the wallet but never enter it; a set allow list bounds both ways.
function breaksTokenLists(input: PolicyInput): boolean {
  const { allowTokens } = input.facts.limits;
  const moved = [
    ...input.subject.outflows.map((item) => item.asset),
    ...input.subject.inflowAssets,
  ];
  return (
    receivesDenied(input) ||
    (allowTokens.length > 0 &&
      moved.some((token) => token !== coin && !allowTokens.includes(token)))
  );
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

function tradeEarned(input: PolicyInput): Earned {
  const { subject, facts } = input;
  const { limits } = facts;
  const slippageLimit =
    subject.slippage?.isRegistryPair === true
      ? limits.maxSlippageBps.registry
      : limits.maxSlippageBps.other;
  return {
    slippage: subject.slippage !== undefined && subject.slippage.bps > slippageLimit,
    tax: facts.knownTaxBps !== undefined && facts.knownTaxBps > limits.maxTaxBps,
    venue_off: subject.venue !== undefined && !limits.venues.includes(subject.venue),
    token_denied: breaksTokenLists(input),
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

// A rescue answers only to its target, in paper mode as well as live (decision 0100).
function rescueReasons(input: PolicyInput): readonly PolicyRejection[] {
  return paysRescue(input) ? [] : ["unsaved_address"];
}

function reasonsFor(input: PolicyInput): readonly PolicyRejection[] {
  return input.subject.kind === "rescue" ? rescueReasons(input) : expectedReasons(input);
}

// An intent the rules let through, with what it broke; one they refuse breaks nothing here.
function violationsOfPass(input: PolicyInput): readonly string[] {
  return policyRefusals(input).length > 0 ? [] : passViolations(input);
}

const rescueAccount = "fake:1:rescue" as AccountRef;

// A rescue that pays the rescue address, paper or live, whatever else holds.
function asRescue(input: PolicyInput): PolicyInput {
  return {
    ...input,
    subject: { ...input.subject, kind: "rescue", target: rescueAccount },
    facts: { ...input.facts, rescueAccount },
  };
}

const rescues: fc.Arbitrary<PolicyInput> = inputs.map(asRescue);

// A sale out of a denied token is marked and nothing else is; a token that enters never is denied.
function listViolations(input: PolicyInput): readonly string[] {
  const isPassed = policyRefusals(input).length === 0;
  return [
    sellsDeniedToken(input) === sellsDenied(input) ? "" : "marked wrong",
    isPassed && receivesDenied(input) ? "passed an intent that receives a denied token" : "",
  ].filter((text) => text !== "");
}

// An auto-mode agent and a trade the agent runtime proposed, which auto mode runs unless told not to.
const allowingAuto: AutoModeFacts = {
  approvalMode: "auto",
  modeVersion: 1,
  isLocked: false,
  isInsideOwnPositions: true,
  sellsDeniedToken: false,
  valueUsdMicros: 0n,
  perTradeCapUsdMicros: 0n,
  rollingDayCapUsdMicros: 0n,
  rollingDaySpentUsdMicros: 0n,
  feePerGasNativeBase: 0n,
  networkFeeCapNativeBase: 0n,
  hasUnlistedSpender: false,
};

const trades: fc.Arbitrary<AutoModeSubject> = fc.record({
  kind: fc.constantFrom("swap" as const, "buy" as const, "sell" as const),
  proposer: fc.constant("agent_runtime" as const),
  hasOutsideContent: fc.constant(false),
});

// Fees per gas and caps from zero to far above the network floor, often one wei apart.
const weiAmounts = fc.bigInt({ min: 0n, max: 10n ** 12n });
const feesAndCaps: fc.Arbitrary<readonly [bigint, bigint]> = fc.oneof(
  fc.tuple(weiAmounts, weiAmounts),
  fc
    .bigInt({ min: 1n, max: 10n ** 12n })
    .chain((cap) => fc.tuple(fc.bigInt({ min: cap - 1n, max: cap + 1n }), fc.constant(cap))),
);

const machine = createIntentStateMachine({
  clock: { now: () => nowMs, sleep: async () => Promise.resolve() },
});

// A rescue the owner asked for while the agent is in paper mode, and how each step treats it.
function paperRescueProblems(input: PolicyInput): readonly string[] {
  const proposed = machine.propose({
    kind: "rescue",
    proposer: "owner",
    isPaper: true,
    hasOutsideContent: input.subject.hasOutsideContent,
    agentStatus: "active",
  });
  if (!proposed.ok) {
    return ["the proposal was refused"];
  }
  const { isPaper } = proposed.value.status;
  const card = { version: 1, openedAtMs: nowMs, expiresAtMs: nowMs + 1 };
  const confirmed: IntentStatus = { ...proposed.value.status, state: "confirmed", card };
  const taken = machine.apply(confirmed, {
    type: "queue_took",
    isAgentLive: false,
    hasPolicyPassed: true,
    confirmation: { cardVersion: 1, expiresAtMs: nowMs + 1 },
  });
  return [
    isPaper ? "stored as a paper intent" : "",
    policyRefusals({ ...input, subject: { ...input.subject, isPaper } }).length > 0
      ? "refused by the policy"
      : "",
    machine.apply(confirmed, { type: "paper_fill_recorded" }).ok ? "filled on paper" : "",
    taken.ok ? "" : "left by the wallet queue",
  ].filter((text) => text !== "");
}

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

  it("let a rescue to the rescue address through a freeze, any send level, any cap and paper mode", () => {
    fc.assert(
      fc.property(rescues, (input) => {
        expect(policyRefusals(input)).toStrictEqual([]);
      }),
    );
  });

  it("mark every sale out of a denied token and pass no intent that receives one", () => {
    // A rescue only moves tokens out, to the owner's own address, so the lists never judge it.
    const intents = inputs.filter((input) => input.subject.kind !== "rescue");
    fc.assert(
      fc.property(intents, (input) => {
        expect(listViolations(input)).toStrictEqual([]);
      }),
      { numRuns: 1_000 },
    );
  });

  it("never let a sale out of a denied token run in auto mode", () => {
    fc.assert(
      fc.property(inputs, trades, (input, trade) => {
        const facts = { ...allowingAuto, sellsDeniedToken: sellsDeniedToken(input) };
        expect(checkAutoMode(trade, facts).ok).toBe(!sellsDenied(input));
      }),
      { numRuns: 1_000 },
    );
  });

  it("never let a fee per gas above the network fee cap run in auto mode", () => {
    fc.assert(
      fc.property(trades, feesAndCaps, (trade, [fee, cap]) => {
        const facts = { ...allowingAuto, feePerGasNativeBase: fee, networkFeeCapNativeBase: cap };
        expect(checkAutoMode(trade, facts).ok).toBe(fee <= cap);
      }),
      { numRuns: 1_000 },
    );
  });

  it("run a rescue asked for in paper mode live: it passes, never fills on paper, and is sent", () => {
    fc.assert(
      fc.property(rescues, (input) => {
        expect(paperRescueProblems(input)).toStrictEqual([]);
      }),
    );
  });
});
