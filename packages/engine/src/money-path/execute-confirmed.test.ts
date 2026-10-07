import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeExecutor } from "../fakes/fake-executor.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createStoredIntents, type IntentSnapshot } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import {
  testAgent,
  testAgentDraft,
  testNowMs,
  testSwap,
  testWallet,
} from "../intents/test-intents.js";
import type { PaperFills } from "../paper/paper-fills.js";
import { createExecuteConfirmed } from "./execute-confirmed.js";

const live = { signal: new AbortController().signal };
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const clock = createManualClock(testNowMs);

// A paper fill that fails the test if anything reaches it.
const paperNeverReached: PaperFills = {
  async fillAtQuote(snapshot) {
    return await Promise.reject(new Error(`Intent ${snapshot.record.id} reached the paper fill.`));
  },
};

// The owner's rescue, proposed while the agent is on paper and stored as the state machine
// decides, then confirmed.
async function rescueOnPaper(): Promise<IntentSnapshot> {
  const stores = createMemoryEngineStores();
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids: createIdSource({ clock, random: createSeededRandom(5) }),
    publish: () => undefined,
  });
  await stores.agents.create(testAgentDraft(), live);
  const machine = createIntentStateMachine({ clock });
  const proposed = machine.propose({
    kind: "rescue",
    proposer: "owner",
    isPaper: true,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  if (!proposed.ok) {
    throw new Error("Expected the rescue to be proposed.");
  }
  // Nothing routes a rescue request yet; the execute step reads the stored state and mode only.
  const created = { id: intent, agentId: testAgent, walletId: testWallet, request: testSwap() };
  await stored.create({ ...created, proposerRef: "telegram", step: proposed.value }, live);
  const { status } = proposed.value;
  const event = {
    from: "proposed",
    to: "confirmed",
    trigger: "authorization_checked",
    atMs: testNowMs,
    hasLedgerEntry: true,
  } as const;
  const step = { status: { ...status, state: "confirmed" as const }, event };
  const moved = await stored.move({ intent, version: 0, step }, live);
  if (!moved.ok) {
    throw new Error("Expected the rescue to be confirmed.");
  }
  return moved.value;
}

describe("the execute step", () => {
  it("hands a rescue confirmed while the agent is on paper to the wallet queue", async () => {
    const rescue = await rescueOnPaper();
    expect([rescue.record.kind, rescue.record.isPaper]).toStrictEqual(["rescue", false]);
    const executor = createFakeExecutor();
    const execute = createExecuteConfirmed({ paper: paperNeverReached, executor });
    await expect(execute(rescue, live)).resolves.toBe(rescue);
    expect(executor.taken()).toStrictEqual([intent]);
  });
});
