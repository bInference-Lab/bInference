import { accountRefSchema, type TxDraft } from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { testLaunch, testLaunchAccount, testLaunchWallet } from "../money-path/test-launches.js";
import type { ExecutionRun } from "./executor-run.js";
import { launchUnsentNotice } from "./launch-unsent-notice.js";

const family = createFakeFamily();
const token = accountRefSchema.parse("fake:1:0x0000000a");
const portal = accountRefSchema.parse("fake:1:0x0000000d");
const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000289");

// A launch's approval of the launchpad for its token first buy, then its create call.
function stepsOf(): readonly TxDraft[] {
  const approval = family.approvalDraft({
    from: testLaunchAccount,
    token,
    spender: portal,
    amountBase: 6_000n,
  });
  if (!approval.ok) {
    throw new Error("The fake family drafts no approval.");
  }
  return [approval.value, { ...approval.value, payload: "create" }];
}

// The run of the launch's plan, as the executor holds it.
const run = { plan: { chain: { family }, steps: stepsOf() } } as unknown as ExecutionRun;

// The launch ended in `state`, as the executor stored it.
function ended(state: "cancelled" | "failed_onchain"): IntentRecord {
  return {
    id: intent,
    agentId: testAgent,
    walletId: testLaunchWallet,
    kind: "launchToken",
    state,
    request: requestDocument.encode({ ...testLaunch, agent: testAgent }),
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 7,
  };
}

describe("the owner's notice of a launch whose step was never signed", () => {
  it("says no token was made and names the approval that still stands once it landed", () => {
    const values = { symbol: testLaunch.symbol, venue: testLaunch.venue, private: "no" };
    expect(launchUnsentNotice(run, ended("failed_onchain"), 1).data).toStrictEqual({
      key: "notice.launchStepUnsent",
      agent: testAgent,
      intent,
      values,
      amounts: { approved: { asset: "fake:1/token:0x0000000a", base: "6000" } },
    });
    expect(launchUnsentNotice(run, ended("cancelled"), 0).data).toStrictEqual({
      key: "notice.launchNotSigned",
      agent: testAgent,
      intent,
      values,
    });
  });
});
