import { type AssetRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import { bpsSchema, type Id, idSchema, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { IntentRequest } from "@binference/protocol";
import type { AgentDraft } from "../agents/agent-record.js";
import type { LimitsValues } from "../agents/limits-record.js";
import type { NewIntent } from "./intent-draft-of.js";
import { createIntentStateMachine } from "./state-machine.js";

/** The time the test intents and the test engine start at. */
export const testNowMs = 1_800_000_000_000;
/** The test agent and its wallet. */
export const testAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);
export const testWallet: Id<"wal"> = idSchema("wal").parse(
  "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);
/** The fake chain's coin and its listed token. */
export const testCoin: AssetRef = assetRefSchema.parse("fake:1/slip44:1");
export const testToken: AssetRef = assetRefSchema.parse("fake:1/token:0x0000000a");

/** Limits that let a small swap of the coin through on the fake venue. */
const testLimits: LimitsValues = {
  perTradeUsdMicros: 1_000_000_000n,
  rollingDayUsdMicros: 5_000_000_000n,
  slippageRegistryBps: bpsSchema.parse(50),
  slippageOtherBps: bpsSchema.parse(300),
  priceImpactBps: bpsSchema.parse(500),
  taxBps: bpsSchema.parse(1_000),
  liquidityFloorUsdMicros: 0n,
  minHealthFactorBp: 15_000,
  gasReserve: [{ chain: chainRefSchema.parse("fake:1"), reserveBase: 10n ** 15n }],
  venues: ["fake-swap"],
  allowTokens: [],
  denyTokens: [],
  modelBudgetUsdMicros: 5_000_000n,
  cardTradeExpiryS: 60,
  cardOtherExpiryS: 600,
  requoteAfterS: 10,
  requoteToleranceBps: bpsSchema.parse(50),
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: 20_000_000n,
  copyPerLeaderDayUsdMicros: 100_000_000n,
};

/** The test agent's draft: a paper agent in manual mode with the test limits. */
export function testAgentDraft(changes: Partial<AgentDraft> = {}): AgentDraft {
  return {
    id: testAgent,
    name: "main",
    mode: "paper",
    locale: "en",
    models: {},
    notifications: {},
    atMs: testNowMs - 1_000,
    limits: testLimits,
    approvalMode: "manual",
    bySurface: "cli",
    ...changes,
  };
}

/** A swap of the test agent as the state machine proposes it, by the agent runtime, on paper. */
export function testNewIntent(id: Id<"int">): NewIntent {
  const machine = createIntentStateMachine({ clock: createManualClock(testNowMs) });
  const step = machine.propose({
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: true,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  if (!step.ok) {
    throw new Error("The test proposal must pass.");
  }
  const request = testSwap();
  return {
    id,
    agentId: testAgent,
    walletId: testWallet,
    request,
    proposerRef: "engine",
    step: step.value,
  };
}

/** A swap of 0.000000000001 of the coin into the token, by the test agent's wallet. */
export function testSwap(
  changes: Partial<Extract<IntentRequest, { kind: "swap" }>> = {},
): IntentRequest {
  return {
    kind: "swap",
    agent: testAgent,
    wallet: testWallet,
    reason: "Rotate into the token",
    from: testCoin,
    to: testToken,
    amount: { base: 1_000_000n },
    ...changes,
  };
}

/** The value of a result a test expects to succeed; a failure fails the test. */
export function expectOk<T, E extends string>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}
