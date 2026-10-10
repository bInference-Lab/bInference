import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { PolicyRejection } from "../intents/intent-reason.js";
import { expectOk, testAgent, testCoin, testNowMs } from "../intents/test-intents.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import { type TestEngine, testChains } from "../operations/test-engine.js";
import { policyRefusals, type PolicySubject } from "../policy/policy-rules.js";
import { looseningWaitMs } from "../policy/send-level-change.js";

const live = { signal: new AbortController().signal };

/** An address the owner saved with the owner key two days before the test starts. */
export const testSaved: AddressEntryRecord = {
  id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agentId: testAgent,
  account: accountRefSchema.parse("fake:1:0x000000f1"),
  label: "savings",
  usableAtMs: testNowMs - looseningWaitMs,
  inCeilingAtMs: testNowMs - 2 * looseningWaitMs,
  createdAtMs: testNowMs - 2 * looseningWaitMs,
};

/** Adds an entry to the test agent's address book. */
export async function saveTestAddress(
  test: TestEngine,
  entry: AddressEntryRecord = testSaved,
): Promise<void> {
  expectOk(await test.stores.agents.addAddress(entry, live));
}

/**
 * What the policy refuses a send of one base unit of the coin to `target` for, with the test
 * agent's stored settings at the test clock's time.
 */
export async function sendRefusals(
  test: TestEngine,
  target: AccountRef = testSaved.account,
): Promise<readonly PolicyRejection[]> {
  const settings = await test.stores.agents.get(testAgent, live);
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  const nowMs = test.clock.now();
  const wallet = {
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    feePerGasNativeBase: 1n,
    networkFeeCapNativeBase: 1n,
    recentOutflows: [],
  };
  const chain = chainRefSchema.parse("fake:1");
  const chains = testChains();
  const facts = policyFactsOf({ settings, wallet, chain, chains, nativeAsset: testCoin, nowMs });
  const subject: PolicySubject = {
    kind: "send",
    isPaper: false,
    hasOutsideContent: false,
    outflows: [{ asset: testCoin, base: 1n }],
    inflowAssets: [],
    target,
  };
  const figures = { valueUsdMicros: 1n, rollingDaySpentUsdMicros: 0n };
  return policyRefusals({ subject, facts, nowMs, figures });
}
