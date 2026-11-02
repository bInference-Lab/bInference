import {
  type ApprovalModeNow,
  type AutoModeGrant,
  chainRefSchema,
  checkAutoModeGrant,
  type Venue,
} from "@binference/chain";
import { createFakeVenue, fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import { mulDiv } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
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
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import { holdTestWallet, testRouter, transferSimulator } from "../sends/test-transfers.js";
import {
  stakedFake,
  stakingChains,
  stakingSimulator,
  testMinStake,
  testStakingVenue,
  testValidator,
} from "../staking/test-stakes.js";
import { autoModeGrantOf } from "./auto-mode-grant-of.js";
import { testSnapshot } from "./test-snapshot.js";

// Spec 6, invariant 8, on the whole engine: the protocol call, the money path, the policy, the
// venue host, the state machine and the stored intents. The outside-content mark has no carrier on
// `intent/propose` yet; the state machine's own invariant 8 property covers it.

const base = { agent: testAgent, wallet: testWallet, reason: "Move funds" } as const;
const coin = { asset: testCoin, base: 1_000_000n };
const stranger = "0x000000ff";
const feeCap = 1_000_000_000n;
// The coin is worth $600, the token $0.000001 a base unit; both round up to whole micro-dollars.
const coinPrice = { numerator: 600n, denominator: 10n ** 12n };
const tokenPrice = { numerator: 1n, denominator: 1n };

// Every request kind but the trades the money path routes (a swap, a buy and a sell): sends and
// approval revokes on their own path, withdrawals, bridges, launches, a stake, an unstake of the
// whole stake and a claim on the fake staking venue, and the kinds it does not route yet.
const otherRequests: readonly IntentRequest[] = [
  { ...base, kind: "send", amount: coin, to: { address: testSaved.account } },
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
  { ...base, kind: "revokeApproval", token: testToken, spender: testRouter },
  { ...base, kind: "lend", action: "withdraw", venue: "fake-lend", amount: coin },
  { ...base, kind: "stake", action: "stake", venue: testStakingVenue, validator: testValidator },
  { ...base, kind: "stake", action: "unstake", venue: testStakingVenue, validator: testValidator },
  { ...base, kind: "stake", action: "claim", venue: testStakingVenue, validator: testValidator },
  { ...base, kind: "cexOrder", market: "BNBUSDT", side: "buy", type: "market", size: "1" },
  { ...base, kind: "registerIdentity" },
];

type CallerName = "runtime" | "mcp" | "cli";

/**
 * What the caller says of its turn: `clean` read no outside content, `marked` read some, and
 * `unknown` is a caller the engine's own runtime does not vouch for.
 */
type TurnName = "clean" | "marked" | "unknown";

interface Case {
  readonly approvalMode: ApprovalMode;
  readonly isLive: boolean;
  readonly caller: CallerName;
  readonly turn: TurnName;
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

const holdingCoin = [{ asset: testCoin, base: 10n ** 18n }];
const holdingToken = [...holdingCoin, { asset: testToken, base: 10n ** 18n }];

// A stake moves at least the fake venue's least stake; an unstake and a claim move no value.
function stakeAmountOf(c: Case): bigint {
  return testMinStake + (c.amountBase % (5n * testMinStake));
}

function stakeActionOf(c: Case): string | undefined {
  const request = c.other === undefined ? undefined : otherRequests[c.other];
  return request?.kind === "stake" ? request.action : undefined;
}

function valueOf(c: Case): bigint {
  const action = stakeActionOf(c);
  if (action !== undefined) {
    return action === "stake" ? mulDiv(stakeAmountOf(c), coinPrice, "up") : 0n;
  }
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
    // The paper portfolio holds the token a swap sells: a fill takes nothing it does not hold.
    paper: c.sellsToken && c.other === undefined ? holdingToken : holdingCoin,
    prices: new Map([
      [testCoin, coinPrice],
      [testToken, tokenPrice],
    ]),
    // A send to the saved address and the token's revoke from the router each reach their card.
    chainSimulator: stakingSimulator(
      transferSimulator(
        [{ to: testSaved.account, amount: coin }],
        [{ token: testToken, spender: testRouter }],
      ),
    ),
  };
}

function requestOf(c: Case): IntentRequest {
  const other = c.other === undefined ? undefined : otherRequests[c.other];
  if (other?.kind === "stake" && other.action === "stake") {
    return { ...other, amount: { asset: testCoin, base: stakeAmountOf(c) } };
  }
  if (other !== undefined) {
    return other;
  }
  const amount = { base: c.amountBase };
  return c.sellsToken ? testSwap({ from: testToken, to: testCoin, amount }) : testSwap({ amount });
}

// Spec 6, section 5, as this test models it: a swap the agent runtime proposes in auto mode, in a
// turn it says read no outside content, from an honest venue, that buys no denied token and sells
// none, inside both caps and the fee cap.
function mayRunAlone(c: Case): boolean {
  return (
    c.approvalMode === "auto" &&
    c.caller === "runtime" &&
    c.turn === "clean" &&
    c.other === undefined &&
    !c.hasStrangerSpender &&
    !c.isTokenDenied &&
    c.perTradeHeadroom >= 0n &&
    c.dayHeadroom >= 0n &&
    c.feeOverCap <= 0n
  );
}

// The agent's approval mode as the signer reads it in a signing request.
async function modeOf(test: TestEngine): Promise<ApprovalModeNow> {
  const settings = await test.stores.agents.get(testAgent, { signal: AbortSignal.timeout(1_000) });
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  const { agentId, mode, version } = settings.approvalMode;
  return { agent: agentId, mode, version };
}

/** What one proposal showed: whether the auto mode ran it, and every rule it broke. */
interface Outcome {
  readonly isAuto: boolean;
  readonly problems: readonly string[];
  /** A send, revoke or bridge that reached its card, which the auto test left to the owner. */
  readonly isAskedTransfer?: boolean;
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
  const again = await test.engine.handlers["intent/propose"](testCall(requestOf(c), callerOf(c)));
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

function callerOf(c: Case): EngineCaller {
  const { turn: _turn, ...signedIn } = testCallers[c.caller];
  const turns: Readonly<Record<TurnName, EngineCaller>> = {
    clean: { ...signedIn, turn: { hasOutsideContent: false } },
    marked: { ...signedIn, turn: { hasOutsideContent: true } },
    unknown: signedIn,
  };
  return turns[c.turn];
}

// The refusal a request the money path does not route meets: a launch the agent or an MCP client
// proposes is the owner's alone (decision 0236), a lend is never served (decision 0296), and every
// other has no route.
function refusalOf(c: Case): string {
  const { kind } = requestOf(c);
  if (kind === "lend") {
    return "intent.kind_unavailable";
  }
  return kind === "launchToken" && c.caller !== "cli" ? "intent.owner_only" : "quote.no_route";
}

// A stake within both caps and a claim run alone for the agent runtime in a clean turn, under the
// fee cap; a claim counts against no cap; an unstake always asks (decision 0296).
function mayStakeAlone(c: Case, action: string): boolean {
  const isAsked =
    c.approvalMode === "auto" && c.caller === "runtime" && c.turn === "clean" && c.feeOverCap <= 0n;
  if (action === "claim") {
    return isAsked && c.isLive;
  }
  return action === "stake" && isAsked && c.perTradeHeadroom >= 0n && c.dayHeadroom >= 0n;
}

// What a staking move's run broke: auto mode against the rules, a cap counting an unstake or a
// claim, or an unstake's card that does not say why auto mode asks.
function stakeProblems(
  c: Case,
  action: string,
  seen: { readonly isAuto: boolean; readonly isValued: boolean; readonly asked?: string },
): readonly string[] {
  const { isAuto, isValued, asked } = seen;
  const shouldAskUnstake = action === "unstake" && c.isLive && mayStakeAlone(c, "claim");
  return [
    ...(isAuto === mayStakeAlone(c, action)
      ? []
      : [`auto mode ${isAuto ? "ran" : "asked for"} the ${action}`]),
    ...(action !== "stake" && isValued ? [`the ${action} counted against the caps`] : []),
    ...(!shouldAskUnstake || asked === "unstake" ? [] : ["the unstake's card names no unstake"]),
  ];
}

async function stakeOutcome(test: TestEngine, c: Case, view: IntentView): Promise<Outcome> {
  const action = stakeActionOf(c) ?? "stake";
  const snapshot = await testSnapshot(test, view.intent);
  const isAuto = snapshot.stored.status.authorizedBy !== undefined;
  const isValued = snapshot.record.valueUsdMicros !== undefined;
  const asked = snapshot.history.cards.at(-1)?.autoAsk;
  const seen = { isAuto, isValued, ...(asked === undefined ? {} : { asked }) };
  return { isAuto, problems: stakeProblems(c, action, seen) };
}

// The case's engine, with the fake staking venue beside the router, which its agent may use.
async function caseEngine(c: Case): Promise<TestEngine> {
  const limits = { ...testLimits, venues: [...testLimits.venues, testStakingVenue] };
  const options = optionsOf(c);
  const stake = { chains: stakingChains(), stakingVenues: [await stakedFake()] };
  const agent = {
    ...options.agent,
    limits: { ...limits, ...options.agent?.limits, venues: limits.venues },
  };
  return startTestEngine({ ...options, ...stake, agent });
}

async function outcomeOf(c: Case): Promise<Outcome> {
  const test = await caseEngine(c);
  await saveTestAddress(test);
  holdTestWallet(test);
  const call = testCall(requestOf(c), callerOf(c));
  const proposed = await test.engine.handlers["intent/propose"](call);
  return c.other === undefined
    ? swapOutcome(test, c, expectOk(proposed))
    : otherOutcome(test, c, proposed);
}

// A request that is no swap: a staking move, a transfer, or a kind the money path refuses.
async function otherOutcome(
  test: TestEngine,
  c: Case,
  proposed: Awaited<ReturnType<TestEngine["engine"]["handlers"]["intent/propose"]>>,
): Promise<Outcome> {
  const { kind } = requestOf(c);
  if (kind === "stake") {
    return stakeOutcome(test, c, expectOk(proposed));
  }
  if (kind === "send" || kind === "revokeApproval" || kind === "bridge") {
    // A send, a revoke and a bridge run their own path, which the auto test always leaves to a tap.
    const state = proposed.ok ? proposed.value.state : undefined;
    const problems = state === "confirmed" ? [`a ${kind} ran alone`] : [];
    return { isAuto: false, problems, isAskedTransfer: state === "awaiting_confirmation" };
  }
  const isRefused = !proposed.ok && proposed.error === refusalOf(c);
  return { isAuto: false, problems: isRefused ? [] : [`a ${kind} was not refused`] };
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
  turn: mostly<TurnName>("clean", "marked", "unknown"),
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

// A send, a bridge and a revoke in a clean runtime turn, each run on every pass, so the count of
// transfers asked for below never rests on the seed drawing one.
const transferCases: readonly (readonly [Case])[] = [0, 1, 3].map((other) => [
  {
    approvalMode: "auto",
    isLive: true,
    caller: "runtime",
    turn: "clean",
    other,
    sellsToken: false,
    amountBase: 10n ** 15n,
    perTradeHeadroom: 10n ** 9n,
    dayHeadroom: 10n ** 9n,
    spentUsdMicros: 0n,
    feeOverCap: 0n,
    isTokenDenied: false,
    hasStrangerSpender: false,
  },
]);

// A stake, an unstake and a claim in a clean runtime turn, live and on paper, each run on every pass.
const stakeCases: readonly (readonly [Case])[] = [5, 6, 7].flatMap((other) =>
  [true, false].map((isLive): readonly [Case] => {
    const [example] = transferCases[0] ?? [];
    if (example === undefined) {
      throw new Error("Expected a transfer case.");
    }
    return [{ ...example, other, isLive }];
  }),
);

describe("auto mode, end to end", () => {
  it("runs alone only a runtime swap within every cap, and a switch to manual ends it", async () => {
    const outcomes: Outcome[] = [];
    await fc.assert(
      fc.asyncProperty(cases, async (c) => {
        const outcome = await outcomeOf(c);
        outcomes.push(outcome);
        expect(outcome.problems).toStrictEqual([]);
      }),
      { numRuns: 200, examples: [...transferCases, ...stakeCases] },
    );
    expect(outcomes.filter((outcome) => outcome.isAuto).length).toBeGreaterThan(0);
    expect(outcomes.filter((outcome) => outcome.isAskedTransfer === true).length).toBeGreaterThan(
      0,
    );
  });
});
