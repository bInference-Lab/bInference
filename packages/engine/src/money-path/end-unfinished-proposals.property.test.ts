import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { type IntentKind, intentKinds } from "../intents/intent-kind.js";
import type { IntentDraft, IntentRecord } from "../intents/intent-record.js";
import { type IntentState, intentStates } from "../intents/intent-state.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { statesBeforeCard } from "../intents/transition-table.js";
import { startTestEngine, type TestEngine } from "../operations/test-engine.js";

const live = { signal: new AbortController().signal };

/** One intent a stop left: its state, its kind, its mode and whether the engine proposed it. */
interface Left {
  readonly state: IntentState;
  readonly kind: IntentKind;
  readonly isPaper: boolean;
  readonly isEngines: boolean;
}

const leftIntents = fc.array(
  fc.record({
    state: fc.constantFrom(...intentStates),
    kind: fc.constantFrom(...intentKinds),
    isPaper: fc.boolean(),
    isEngines: fc.boolean(),
  }),
  { maxLength: 12 },
);

// Stores intent `n` as a stop left it, straight in its state, as the engine's writer wrote it: its
// first event names who proposed it.
async function plant(test: TestEngine, left: Left, n: number): Promise<void> {
  const id = fixtureId("int", n);
  const draft: IntentDraft = {
    id,
    agentId: testAgent,
    walletId: testWallet,
    kind: left.kind,
    state: "proposed",
    request: { kind: left.kind },
    hasOutsideContent: false,
    isPaper: left.isPaper,
    proposer: left.isEngines ? "engine" : fixtureId("tok", 1),
    atMs: testNowMs + n,
    cause: { trigger: "propose", proposer: left.isEngines ? "engine" : "owner" },
  };
  await test.stores.intents.create(draft, live);
  if (left.state !== "proposed") {
    const move = { id, expectedVersion: 0, state: left.state, atMs: testNowMs + n };
    await test.stores.intents.transition({ ...move, cause: { trigger: "planted" } }, live);
  }
}

// Decision 0444: every intent before its card ends, but a fill, which the engine proposed, and a
// token launch past `proposed`, which their own repairs end.
function endsAtStart(left: Left): boolean {
  const isLaunchFollowed = left.kind === "launchToken" && left.state !== "proposed";
  return statesBeforeCard.includes(left.state) && !left.isEngines && !isLaunchFollowed;
}

async function everyIntent(test: TestEngine): Promise<readonly IntentRecord[]> {
  const listed = await test.stores.intents.list({ states: [...intentStates], limit: 50 }, live);
  return listed.toSorted((left, right) => left.createdAtMs - right.createdAtMs);
}

// What the start must leave of each intent: cancelled one version on, or as it was.
function expectedAfter(before: readonly IntentRecord[], lefts: readonly Left[]) {
  return before.map((record, n) => {
    const left = lefts[n];
    return left !== undefined && endsAtStart(left)
      ? { id: record.id, state: "cancelled", version: record.version + 1 }
      : { id: record.id, state: record.state, version: record.version };
  });
}

describe("the start's end of the proposals a stop left", () => {
  it("cancels exactly the intents before their cards that no repair of their own ends, once", async () => {
    await fc.assert(
      fc.asyncProperty(leftIntents, async (lefts: readonly Left[]) => {
        const test = await startTestEngine({ paper: [] });
        await lefts.reduce(async (planted, left, n) => {
          await planted;
          await plant(test, left, n + 1);
        }, Promise.resolve());
        const before = await everyIntent(test);

        const ended = await test.restart().endUnfinishedProposals(live);

        const after = await everyIntent(test);
        expect(after.map(({ id, state, version }) => ({ id, state, version }))).toStrictEqual(
          expectedAfter(before, lefts),
        );
        expect(ended).toBe(lefts.filter(endsAtStart).length);
        await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(0);
        expect(test.pushes.filter((push) => push.topic === "notice")).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("reads every page of them, past pages of fills it leaves alone", async () => {
    const test = await startTestEngine({ paper: [] });
    const fill: Left = { state: "checked", kind: "swap", isPaper: true, isEngines: true };
    const proposal: Left = { ...fill, isEngines: false };
    const lefts: readonly Left[] = [
      ...Array.from({ length: 150 }, () => fill),
      ...Array.from({ length: 205 }, () => proposal),
    ];
    await lefts.reduce(async (planted, left, n) => {
      await planted;
      await plant(test, left, n + 1);
    }, Promise.resolve());

    await expect(test.restart().endUnfinishedProposals(live)).resolves.toBe(205);
  });
});
