import { createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsPerWhole, type Ratio } from "@binference/core";
import type { FillSize, WebhookRuleRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quoteDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testLimits, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { testCall } from "../operations/test-engine.js";
import {
  eightyCentsUsd,
  fillIntentsOf,
  fillPrices,
  startFillEngine,
  wholeToken,
} from "../orders/test-fills.js";
import { freeze, tapCard } from "../orders/test-orders.js";
import type { AlertFillRecord } from "./alert-fill-record.js";
import { webhookFillWindowMs } from "./fill-alert.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

const live = { signal: new AbortController().signal };
const coinHeld = 10n ** 18n;
const coinUsd: Ratio = { numerator: 600n, denominator: 10n ** 12n };
const reserveBase = testLimits.gasReserve[0]?.reserveBase ?? 0n;

/** What the owner or the engine does as an alert waits: nothing, a rotation, a freeze, a lock. */
type Between = "none" | "rotate" | "freeze" | "lock";

/**
 * One alert the sender sends: its body, how long the fills wait before they run, and what happens
 * meanwhile: the engine locked as it arrives, or its URL rotated or its agent frozen before its
 * fill runs.
 */
interface Sent {
  readonly body: string;
  readonly waitMs: number;
  readonly between: Between;
}

/**
 * One generated rule, the wallet's paper token, the venue's rate, the deny list, the agent's
 * rolling cap and the alerts sent to it.
 */
interface Case {
  readonly request: WebhookRuleRequest;
  readonly tokens: bigint;
  readonly rate: Ratio;
  readonly isDenied: boolean;
  readonly dayCapUsdMicros: bigint;
  readonly sent: readonly Sent[];
}

const sizes: fc.Arbitrary<FillSize> = fc.oneof(
  fc.bigInt({ min: 1n, max: 3n * wholeToken }).map((base) => ({ base })),
  fc.bigInt({ min: 1n, max: 10n ** 16n }).map((base) => ({ base })),
  fc.integer({ min: 1, max: bpsPerWhole }).map((share) => ({ percentBps: share as Bps })),
  fc.bigInt({ min: 1n, max: 3_000_000n }).map((usdMicros) => ({ usdMicros })),
);

const requests: fc.Arbitrary<WebhookRuleRequest> = fc
  .record(
    {
      side: fc.constantFrom<"buy" | "sell">("buy", "sell"),
      size: sizes,
      worstPrice: fc.bigInt({ min: 1n, max: 2_000_000n }),
      maxSlippageBps: fc.integer({ min: 0, max: 50 }).map((bps) => bps as Bps),
      maxFills: fc.integer({ min: 1, max: 3 }),
      ratePerMinute: fc.integer({ min: 1, max: 3 }),
    },
    { requiredKeys: ["side", "size", "ratePerMinute"] },
  )
  .map((bounds) => testRuleRequest(bounds));

// Fills that run at once, within the minute, or past it, and a pause past the repeat window.
const sentAlerts: fc.Arbitrary<Sent> = fc.record({
  body: fc.constantFrom("BNB up", "BNB down", '{"id":"same"}', '{"id":"other"}'),
  waitMs: fc.constantFrom(0, 30_000, 60_000, 700_000),
  between: fc.oneof(
    { weight: 6, arbitrary: fc.constant<Between>("none") },
    { weight: 1, arbitrary: fc.constantFrom<Between>("rotate", "freeze", "lock") },
  ),
});

// A flag that holds in one case in six, so most cases reach a fill.
const rarely = fc.oneof(
  { weight: 5, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);

const cases: fc.Arbitrary<Case> = fc.record({
  request: requests,
  tokens: fc.oneof(
    { weight: 1, arbitrary: fc.constant(0n) },
    { weight: 5, arbitrary: fc.bigInt({ min: 1n, max: 2n * wholeToken }) },
  ),
  rate: fc.record({
    numerator: fc.bigInt({ min: 1n, max: 10n ** 13n }),
    denominator: fc.bigInt({ min: 1n, max: 10n ** 4n }),
  }),
  isDenied: rarely,
  // The test limits' cap, or one a fill or two reaches.
  dayCapUsdMicros: fc.oneof(
    { weight: 3, arbitrary: fc.constant(testLimits.rollingDayUsdMicros) },
    { weight: 1, arbitrary: fc.bigInt({ min: 100_000n, max: 1_500_000n }) },
  ),
  sent: fc.array(sentAlerts, { minLength: 1, maxLength: 6 }),
});

// The agent's slippage for a pair outside the registry, which holds when the rule names none.
const agentSlippageBps = BigInt(testLimits.slippageOtherBps);

// The most one fill may spend, worked out apart from the engine, from what the wallet first held:
// each fill spends from what is left, so this bounds every one.
function oracleLimit(request: WebhookRuleRequest, held: bigint): bigint {
  const { size } = request;
  const isBuy = request.side === "buy";
  const balance = isBuy ? coinHeld - reserveBase : held;
  if ("percentBps" in size) {
    return (balance * BigInt(size.percentBps)) / BigInt(bpsPerWhole);
  }
  const price = isBuy ? coinUsd : eightyCentsUsd;
  const asked = "base" in size ? size.base : (size.usdMicros * price.denominator) / price.numerator;
  return isBuy || asked < held ? asked : held;
}

// Whether a quote's price at its minimum out stays inside the rule's worst price.
function holdsWorst(request: WebhookRuleRequest, record: IntentRecord): boolean {
  const { worstPrice } = request;
  if (worstPrice === undefined || record.quote === undefined) {
    return true;
  }
  const quote = quoteDocument.decode(record.quote);
  const isBuy = request.side === "buy";
  const coin = isBuy ? quote.amountIn.base : quote.minOut.base;
  const tokens = isBuy ? quote.minOut.base : quote.amountIn.base;
  const dollars = coin * coinUsd.numerator * wholeToken;
  const atWorst = worstPrice * tokens * coinUsd.denominator;
  return isBuy ? dollars <= atWorst : dollars >= atWorst;
}

// What a filled intent breaks of its rule's shape: its kind, token, wallet and mode.
function shapeViolations(rule: WebhookRuleRecord, record: IntentRecord): readonly string[] {
  const request = requestDocument.decode(record.request);
  const isOwnToken = "token" in request && request.token === rule.request.token;
  const isOwnWallet = record.walletId === rule.walletId && record.isPaper;
  return [
    request.kind === rule.request.side ? "" : `a ${rule.request.side} rule made a ${request.kind}`,
    isOwnToken ? "" : "another token",
    isOwnWallet ? "" : "another wallet or a live fill",
  ];
}

// Whether the quote's own slippage, its expected output less its minimum, stays at most the
// rule's, else the agent's.
function holdsSlippage(request: WebhookRuleRequest, record: IntentRecord): boolean {
  if (record.quote === undefined) {
    return true;
  }
  const quote = quoteDocument.decode(record.quote);
  const most =
    request.maxSlippageBps === undefined ? agentSlippageBps : BigInt(request.maxSlippageBps);
  const given = quote.expectedOut.base - quote.minOut.base;
  return given * BigInt(bpsPerWhole) <= most * quote.expectedOut.base;
}

// What a filled intent breaks of its rule's bounds and the agent's limits: its size, its worst
// price, its slippage, the per-trade cap and the deny list, a buy's and a sale's alike (decisions
// 0101 and 0299).
function boundViolations(
  item: Case,
  rule: WebhookRuleRecord,
  record: IntentRecord,
): readonly string[] {
  const spent = record.quote === undefined ? 0n : quoteDocument.decode(record.quote).amountIn.base;
  return [
    spent > 0n && spent <= oracleLimit(rule.request, item.tokens) ? "" : `spent ${String(spent)}`,
    holdsWorst(rule.request, record) ? "" : "past the worst price",
    holdsSlippage(rule.request, record) ? "" : "past the slippage",
    (record.valueUsdMicros ?? 0n) <= testLimits.perTradeUsdMicros ? "" : "past the per-trade cap",
    item.isDenied ? "traded a denied token" : "",
  ];
}

// Whether a fill started within the minute after the alert it filled (decision 0336).
function isInTime(record: IntentRecord, alert: AlertFillRecord | undefined): boolean {
  return alert !== undefined && record.createdAtMs - alert.receivedAtMs < webhookFillWindowMs;
}

function violationsOf(
  item: Case,
  rule: WebhookRuleRecord,
  filled: { readonly record: IntentRecord; readonly alert: AlertFillRecord | undefined },
): readonly string[] {
  const { record, alert } = filled;
  return [
    ...shapeViolations(rule, record),
    ...boundViolations(item, rule, record),
    isInTime(record, alert) ? "" : "filled an alert past its minute, or one it did not accept",
  ].filter((text) => text !== "");
}

/** A case's engine, and the lock a case's alerts turn on and off. */
interface Bench {
  readonly test: TestEngine;
  readonly lock: (state: { readonly isLocked: boolean }) => void;
}

async function engineFor(item: Case): Promise<Bench> {
  const limits = {
    ...testLimits,
    denyTokens: item.isDenied ? [testToken] : [],
    rollingDayUsdMicros: item.dayCapUsdMicros,
  };
  const state = { isLocked: false };
  const test = await startFillEngine({
    tokens: item.tokens,
    venues: [createFakeVenue({ rate: item.rate })],
    agent: { limits },
    prices: fillPrices,
    isLocked: () => state.isLocked,
  });
  const lock = (next: { readonly isLocked: boolean }): void => {
    state.isLocked = next.isLocked;
  };
  return { test, lock };
}

/** What the listener answered each alert, and whether each one may fill. */
interface SentAlert {
  readonly answer: string;
  readonly mayFill: boolean;
}

// Sends one alert with what happens as it waits, then runs the fills; answers whether it may
// fill, and the URL from then on.
async function sendOne(
  bench: Bench,
  call: { readonly url: string; readonly rule: CreatedRule; readonly sent: Sent },
): Promise<SentAlert & { readonly url: string }> {
  const { test, lock } = bench;
  const { body, waitMs, between } = call.sent;
  // The engine is locked only as the alert arrives: its fill skips all the same (decision 0336).
  lock({ isLocked: between === "lock" });
  const answer = await alertTo(test, call.url, body);
  lock({ isLocked: false });
  // A rule its last fill ended takes no rotation, and its URL answers nothing either way.
  const rotation = test.engine.handlers["webhookRule/rotateUrl"];
  const rotated =
    between === "rotate" ? await rotation(testCall({ rule: call.rule.rule })) : undefined;
  const url = rotated?.ok === true ? rotated.value.url : call.url;
  if (between === "freeze") {
    await freeze(test);
  }
  await test.clock.advance(waitMs);
  await test.engine.fillWebhookAlerts(live);
  return { answer, url, mayFill: between === "none" };
}

// Sends each alert, waits, then runs the fills, in the order the sender sent them, and answers
// what the listener answered each and whether it may fill. Once the agent is frozen nothing may.
async function sendAll(bench: Bench, rule: CreatedRule, item: Case): Promise<readonly SentAlert[]> {
  const answers: SentAlert[] = [];
  let url = rule.url;
  let isFrozen = false;
  for (const each of item.sent) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each alert, then the wait, then the fills
    const one = await sendOne(bench, { url, rule, sent: each });
    isFrozen = isFrozen || each.between === "freeze";
    url = one.url;
    answers.push({ answer: one.answer, mayFill: one.mayFill && !isFrozen });
  }
  return answers;
}

// Every alert the oracle says may not fill, one a rotation, a lock or a freeze kept out, that
// filled; and the fills past the agent's rolling cap, which every fill of the run counts.
function stateViolations(
  item: Case,
  answered: readonly SentAlert[],
  run: { readonly alerts: readonly AlertFillRecord[]; readonly filled: readonly IntentRecord[] },
): readonly string[] {
  const accepted = answered.filter(({ answer }) => answer === "accepted");
  const oldest = run.alerts.toReversed();
  const kept = oldest.filter(
    (alert, n) => accepted[n]?.mayFill === false && alert.outcome === "filled",
  );
  const spent = run.filled.reduce((sum, record) => sum + (record.valueUsdMicros ?? 0n), 0n);
  return [
    kept.length === 0 ? "" : "filled an alert a rotation, a lock or a freeze kept out",
    spent <= item.dayCapUsdMicros ? "" : "past the rolling cap",
  ];
}

// Every way a run's fills broke their rule, a fill past its most, a count that differs from the
// fills, an alert filled twice, a repeat that filled, and a fill that opened a card.
async function runViolations(item: Case): Promise<readonly string[]> {
  const bench = await engineFor(item);
  const { test } = bench;
  const created = await createdRule(test, item.request);
  await tapCard(test, created.intent, "confirm");
  const answered = await sendAll(bench, created, item);
  const rule = await test.stores.webhookRules.get(created.rule, live);
  if (rule === undefined) {
    return ["the rule is gone"];
  }
  const alerts = await test.stores.webhookRules.alerts({ ruleId: rule.id, limit: 50 }, live);
  const filled = (await fillIntentsOf(test)).filter(({ state }) => state === "paper_filled");
  const cards = await Promise.all(
    filled.map(async ({ id }) => test.stores.intents.cards(id, live)),
  );
  const filledAlerts = alerts.filter(({ outcome }) => outcome === "filled");
  const alertOf = (record: IntentRecord) =>
    filledAlerts.find(({ intentId }) => intentId === record.id);
  return [
    ...filled.flatMap((record) => violationsOf(item, rule, { record, alert: alertOf(record) })),
    rule.maxFills === undefined || filled.length <= rule.maxFills ? "" : "too many fills",
    rule.fills === filled.length ? "" : "the rule's fills differ from its paper fills",
    filledAlerts.length === filled.length ? "" : "an alert filled twice, or a fill of no alert",
    alerts.length === answered.filter(({ answer }) => answer === "accepted").length
      ? ""
      : "a repeat or an alert over the rate was taken",
    ...stateViolations(item, answered, { alerts, filled }),
    alerts.every(({ outcome }) => outcome !== undefined) ? "" : "an alert never ended",
    cards.every((list) => list.length === 0) ? "" : "a fill opened a card",
  ].filter((text) => text !== "");
}

describe("a webhook rule's fills, for every rule, holding, price, deny list and alerts", () => {
  it("never go outside their rule's bounds, its mode, its token, its minute or the caps", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(await runViolations(item)).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("fill a sale that holds every bound, so the check is not empty", async () => {
    const item: Case = {
      request: testRuleRequest(),
      tokens: wholeToken,
      rate: { numerator: 2n, denominator: 1n },
      isDenied: false,
      dayCapUsdMicros: testLimits.rollingDayUsdMicros,
      sent: [{ body: "BNB up", waitMs: 0, between: "none" }],
    };
    const { test } = await engineFor(item);
    const created = await createdRule(test, item.request);
    await tapCard(test, created.intent, "confirm");
    await alertTo(test, created.url, "BNB up");
    await test.engine.fillWebhookAlerts(live);
    expect(await fillIntentsOf(test)).toMatchObject([{ state: "paper_filled" }]);
    expect(await runViolations(item)).toStrictEqual([]);
  });
});
