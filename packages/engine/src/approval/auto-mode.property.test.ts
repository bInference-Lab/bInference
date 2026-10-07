import { accountRefSchema, chainRefSchema, type Venue } from "@binference/chain";
import { createFakeVenue, fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import { mulDiv } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import type { ApprovalMode } from "../intents/auto-mode.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { autoModeGrantOf } from "./auto-mode-grant-of.js";
import { type AutoModeGrant, checkAutoModeGrant } from "./auto-mode-grant.js";
import { testSnapshot } from "./test-snapshot.js";

// Spec 6, invariant 8, on the whole engine: the protocol call, the money path, the policy, the
// venue host, the state machine and the stored intents. The outside-content mark has no carrier on
// `intent/propose` yet; the state machine's own invariant 8 property covers it.

const base = { agent: testAgent, wallet: testWallet, reason: "Move funds" } as const;
const coin = { asset: testCoin, base: 1_000_000n };
const outside = accountRefSchema.parse("fake:1:0x000000ee");
const stranger = "0x000000ff";
const feeCap = 1_000_000_000n;
// The coin is worth $600, the token $0.000001 a base unit; both round up to whole micro-dollars.
const coinPrice = { numerator: 600n, denominator: 10n ** 12n };
const tokenPrice = { numerator: 1n, denominator: 1n };

// Every request kind but the swap: sends, withdrawals, bridges, launches and the kinds the money
// path does not route yet.
const otherRequests: readonly IntentRequest[] = [
  { ...base, kind: "send", amount: coin, to: { address: outside } },
  {
    ...base,
    kind: "bridge",
    amount: coin,
    toChain: chainRefSchema.parse("fake:2"),
    to: { rescue: true },
  },
  {
    ...base,
    kind: "launchToken",
    venue: "fake-launch",
    name: "Moon",
    symbol: "MOON",
    image: "img_1",
    pairWith: testCoin,
  },
  { ...base, kind: "revokeApproval", token: testToken, spender: outside },
  { ...base, kind: "lend", action: "withdraw", venue: "fake-lend", amount: coin },
  { ...base, kind: "stake", action: "unstake", venue: "fake-stake", amount: coin },
  { ...base, kind: "buy", token: testToken, spend: coin },
  { ...base, kind: "sell", token: testToken, amount: { base: 1_000n } },
  { ...base, kind: "cexOrder", market: "BNBUSDT", side: "buy", type: "market", size: "1" },
  { ...base, kind: "registerIdentity" },
];

type CallerName = "runtime" | "mcp" | "cli";

interface Case {
  readonly approvalMode: ApprovalMode;
  readonly isLive: boolean;
  readonly caller: CallerName;
  /** The other request to propose, by its place in the list; `undefined`: a swap. */
  readonly other: number | undefined;
  /** The swap sells the token for the coin, instead of the coin for the token. */
  readonly sellsToken: boolean;
  readonly amountBase: bigint;
  readonly perTradeHeadroom: bigint;
  readonly dayHeadroom: bigint;
  readonly spentUsdMicros: bigint;
  readonly feeOverCap: bigint;
  readonly isTokenDenied: boolean;
  /** The venue approves a contract it never declared. */
  readonly hasStrangerSpender: boolean;
}

// The fake venue, building an approval to a stranger before its trade call.
function strangerSpenderVenue(): Venue {
  const venue = createFakeVenue();
  return {
    ...venue,
    async build(request, options) {
      const steps = await venue.build(request, options);
      const approval = fakeDraft(request.wallet, {
        to: "0x0000000a",
        value: 0n,
        data: fakeApprovalData(stranger, request.amountIn.base),
      });
      return [approval, ...steps.slice(-1)];
    },
  };
}

function valueOf(c: Case): bigint {
  return mulDiv(c.amountBase, c.sellsToken ? tokenPrice : coinPrice, "up");
}

function atLeastZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function optionsOf(c: Case): TestEngineOptions {
  const value = valueOf(c);
  const limits = {
    ...testLimits,
    perTradeUsdMicros: atLeastZero(value + c.perTradeHeadroom),
    rollingDayUsdMicros: atLeastZero(c.spentUsdMicros + value + c.dayHeadroom),
    denyTokens: c.isTokenDenied ? [testToken] : [],
  };
  const spent = [{ atMs: testNowMs - 1_000, valueUsdMicros: c.spentUsdMicros }];
  return {
    agent: { approvalMode: c.approvalMode, mode: c.isLive ? "live" : "paper", limits },
    facts: { feePerGasNativeBase: feeCap + c.feeOverCap, recentOutflows: spent },
    venues: [c.hasStrangerSpender ? strangerSpenderVenue() : createFakeVenue()],
    prices: new Map([
      [testCoin, coinPrice],
      [testToken, tokenPrice],
    ]),
  };
}

function requestOf(c: Case): IntentRequest {
  const other = c.other === undefined ? undefined : otherRequests[c.other];
  if (other !== undefined) {
    return other;
  }
  const amount = { base: c.amountBase };
  return c.sellsToken ? testSwap({ from: testToken, to: testCoin, amount }) : testSwap({ amount });
}

// Spec 6, section 5, as this test models it: a swap the agent runtime proposes in auto mode, from
// an honest venue, that buys no denied token and sells none, inside both caps and the fee cap.
function mayRunAlone(c: Case): boolean {
  return (
    c.approvalMode === "auto" &&
    c.caller === "runtime" &&
    c.other === undefined &&
    !c.hasStrangerSpender &&
    !c.isTokenDenied &&
    c.perTradeHeadroom >= 0n &&
    c.dayHeadroom >= 0n &&
    c.feeOverCap <= 0n
  );
}

async function modeOf(test: TestEngine): Promise<ApprovalModeRecord> {
  const settings = await test.stores.agents.get(testAgent, { signal: AbortSignal.timeout(1_000) });
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  return settings.approvalMode;
}

/** What one proposal showed: whether the auto mode ran it, and every rule it broke. */
interface Outcome {
  readonly isAuto: boolean;
  readonly problems: readonly string[];
}

// The grant holds until the owner switches to manual; then it ends, and the same trade asks.
async function switchProblems(
  test: TestEngine,
  c: Case,
  grant: AutoModeGrant,
): Promise<readonly string[]> {
  const signing = {
    intent: grant.intent,
    termsHash: grant.termsHash,
    feePerGasNativeBase: feeCap + c.feeOverCap,
    nowMs: test.clock.now(),
  };
  const before = checkAutoModeGrant(grant, { ...signing, approvalMode: await modeOf(test) });
  const manual = testCall({ agent: testAgent, mode: "manual" as const });
  expectOk(await test.engine.handlers["approval/set"](manual));
  const after = checkAutoModeGrant(grant, { ...signing, approvalMode: await modeOf(test) });
  const again = await test.engine.handlers["intent/propose"](
    testCall(requestOf(c), testCallers.runtime),
  );
  const repeat = await testSnapshot(test, expectOk(again).intent);
  return [
    ...(before.ok ? [] : [`the grant failed before the switch: ${before.error}`]),
    ...(after.ok || after.error !== "manual" ? ["the grant outlived the switch to manual"] : []),
    ...(repeat.stored.status.authorizedBy === undefined ? [] : ["auto mode ran after the switch"]),
  ];
}

async function swapOutcome(test: TestEngine, c: Case, view: IntentView): Promise<Outcome> {
  const snapshot = await testSnapshot(test, view.intent);
  const isAuto = snapshot.stored.status.authorizedBy !== undefined;
  const grant = autoModeGrantOf(snapshot, { networkFeeCapNativeBase: feeCap });
  const problems = [
    ...(isAuto === mayRunAlone(c) ? [] : [`auto mode ${isAuto ? "ran" : "asked for"} the swap`]),
    ...((grant !== undefined) === isAuto ? [] : ["the grant does not match the authorization"]),
    ...(isAuto && view.card !== undefined ? ["an auto trade opened a card"] : []),
    ...(grant === undefined ? [] : await switchProblems(test, c, grant)),
  ];
  return { isAuto, problems };
}

async function outcomeOf(c: Case): Promise<Outcome> {
  const test = await startTestEngine(optionsOf(c));
  const call = testCall(requestOf(c), testCallers[c.caller]);
  const proposed = await test.engine.handlers["intent/propose"](call);
  if (c.other === undefined) {
    return swapOutcome(test, c, expectOk(proposed));
  }
  const isRefused = !proposed.ok && proposed.error === "quote.no_route";
  return { isAuto: false, problems: isRefused ? [] : [`a ${requestOf(c).kind} was not refused`] };
}

// Each condition holds most of the time, so a run meets the one that fails among those that hold.
function mostly<T>(usual: T, ...rare: readonly T[]): fc.Arbitrary<T> {
  return fc.oneof(
    { weight: 4, arbitrary: fc.constant(usual) },
    { weight: 1, arbitrary: fc.constantFrom(...rare) },
  );
}

// Below, at or above a cap, mostly at or above.
const headroom = fc.oneof(
  { weight: 1, arbitrary: fc.bigInt({ min: -1_000n, max: -1n }) },
  { weight: 1, arbitrary: fc.constant(0n) },
  { weight: 3, arbitrary: fc.bigInt({ min: 1n, max: 10n ** 9n }) },
);

const cases: fc.Arbitrary<Case> = fc.record({
  approvalMode: mostly<ApprovalMode>("auto", "manual"),
  isLive: fc.boolean(),
  caller: mostly<CallerName>("runtime", "mcp", "cli"),
  other: mostly<number | undefined>(undefined, ...otherRequests.keys()),
  sellsToken: fc.boolean(),
  amountBase: fc.bigInt({ min: 1n, max: 9n * 10n ** 17n }),
  perTradeHeadroom: headroom,
  dayHeadroom: headroom,
  spentUsdMicros: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  feeOverCap: fc.oneof(
    { weight: 3, arbitrary: fc.bigInt({ min: -feeCap, max: 0n }) },
    { weight: 1, arbitrary: fc.bigInt({ min: 1n, max: feeCap }) },
  ),
  isTokenDenied: fc.boolean(),
  hasStrangerSpender: mostly(false, true),
});

describe("auto mode, end to end", () => {
  it("runs alone only a runtime swap within every cap, and a switch to manual ends it", async () => {
    const outcomes: Outcome[] = [];
    await fc.assert(
      fc.asyncProperty(cases, async (c) => {
        const outcome = await outcomeOf(c);
        outcomes.push(outcome);
        expect(outcome.problems).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
    expect(outcomes.filter((outcome) => outcome.isAuto).length).toBeGreaterThan(0);
  });
});
