import { describe, expect, it } from "vitest";
import { intentDraft, intentMove, type IntentStoreSubject } from "../contracts/intent-fixtures.js";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createMemoryIntentStore } from "../fakes/memory-intent-store.js";
import { createMemoryLedgerStore } from "../fakes/memory-ledger-store.js";
import type { IntentDraft } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import { isFirstLiveCard } from "./first-live-card.js";

interface Stored {
  readonly draft: Partial<IntentDraft>;
  readonly state?: IntentState;
}

interface Numbered extends Stored {
  readonly n: number;
}

// The agent's intents, numbered from 1 in order, each moved to its state when it has one.
async function storing(intents: readonly Stored[]): Promise<IntentStoreSubject> {
  const ledger = createMemoryLedgerStore();
  const subject: IntentStoreSubject = {
    store: createMemoryIntentStore({ ledger }),
    ledger,
    agentId: fixtureId("agt", 1),
    walletId: fixtureId("wal", 1),
  };
  const numbered: readonly Numbered[] = intents.map((item, index) => ({ ...item, n: index + 1 }));
  await inOrder(numbered, async ({ n, draft, state }) => {
    await subject.store.create({ ...intentDraft(subject, n), ...draft }, live());
    return state === undefined
      ? undefined
      : subject.store.transition(intentMove(n, 0, state), live());
  });
  return subject;
}

async function first(subject: IntentStoreSubject, n: number): Promise<boolean> {
  const record = await subject.store.get(fixtureId("int", n), live());
  if (record === undefined) {
    throw new Error(`Expected intent ${String(n)}.`);
  }
  return isFirstLiveCard(subject.store, record, live());
}

const liveSwap = { isPaper: false };

describe("the first live card", () => {
  it("is the card of the agent's first live intent, never one after it", async () => {
    const subject = await storing([
      { draft: {}, state: "awaiting_confirmation" },
      { draft: liveSwap, state: "awaiting_confirmation" },
      { draft: liveSwap, state: "awaiting_confirmation" },
    ]);
    expect([
      await first(subject, 1),
      await first(subject, 2),
      await first(subject, 3),
    ]).toStrictEqual([false, true, false]);
    const alone = await storing([{ draft: liveSwap, state: "awaiting_confirmation" }]);
    expect(await first(alone, 1)).toBe(true);
  });

  it("counts a live intent that ended before its card as no live card", async () => {
    const subject = await storing([
      { draft: liveSwap, state: "rejected_policy" },
      { draft: liveSwap },
      { draft: liveSwap, state: "awaiting_confirmation" },
    ]);
    expect(await first(subject, 3)).toBe(true);
  });

  it("leaves a rescue out on either side, as it runs live in paper mode too", async () => {
    const rescue = { ...liveSwap, kind: "rescue" } as const;
    const subject = await storing([
      { draft: rescue, state: "awaiting_confirmation" },
      { draft: liveSwap, state: "awaiting_confirmation" },
    ]);
    expect([await first(subject, 1), await first(subject, 2)]).toStrictEqual([false, true]);
  });
});
