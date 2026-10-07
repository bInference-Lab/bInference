import { createIdSource, err, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import {
  createStoredIntents,
  type IntentSnapshot,
  type StoredIntents,
} from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import {
  testAgentDraft,
  testCoin,
  testNewIntent,
  testNowMs,
  testToken,
} from "../intents/test-intents.js";
import { createPaperFills } from "./paper-fills.js";

const live = { signal: new AbortController().signal };
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const clock = createManualClock(testNowMs);

interface Held {
  readonly stored: StoredIntents;
  readonly snapshot: IntentSnapshot;
}

// A paper swap stored in `proposed`, then moved straight to `confirmed` when asked, with no quote.
async function holding(state: "proposed" | "confirmed"): Promise<Held> {
  const stores = createMemoryEngineStores();
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids: createIdSource({ clock, random: createSeededRandom(13) }),
    publish: () => undefined,
  });
  await stores.agents.create(testAgentDraft(), live);
  const proposed = testNewIntent(intent);
  await stored.create(proposed, live);
  const { status } = proposed.step;
  const event = {
    from: "proposed",
    to: state,
    trigger: "authorization_checked",
    atMs: testNowMs,
    hasLedgerEntry: true,
  } as const;
  await stored.move({ intent, version: 0, step: { status: { ...status, state }, event } }, live);
  const snapshot = await stored.snapshot(intent, live);
  if (snapshot === undefined) {
    throw new Error("Expected the intent to be stored.");
  }
  return { stored, snapshot };
}

describe("paper fills", () => {
  it("leave an intent the state machine does not let fill as it was", async () => {
    const { stored, snapshot } = await holding("proposed");
    await expect(createPaperFills({ stored, clock }).fillAtQuote(snapshot, live)).resolves.toBe(
      snapshot,
    );
  });

  it("fault on a confirmed paper intent with no quote to fill at", async () => {
    const { stored, snapshot } = await holding("confirmed");
    await expect(
      createPaperFills({ stored, clock }).fillAtQuote(snapshot, live),
    ).rejects.toMatchObject({
      code: "engine.no_quote",
    });
  });

  it("answer with the intent as another write left it when the fill loses its race", async () => {
    const { stored, snapshot } = await holding("confirmed");
    const quote = quoteDocument.encode({
      route: [],
      amountIn: { asset: testCoin, base: 1n },
      expectedOut: { asset: testToken, base: 2n },
      minOut: { asset: testToken, base: 2n },
      priceImpactBps: 0 as never,
      gas: { asset: testCoin, base: 0n },
      quotedAt: testNowMs,
      expiresAt: testNowMs,
    });
    const losing: StoredIntents = {
      ...stored,
      move: async () => await Promise.resolve(err("stale")),
    };
    const fills = createPaperFills({ stored: losing, clock });
    const quoted = { ...snapshot, record: { ...snapshot.record, quote } };
    await expect(fills.fillAtQuote(quoted, live)).resolves.toStrictEqual(snapshot);
  });
});
