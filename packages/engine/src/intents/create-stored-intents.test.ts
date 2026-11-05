import { createIdSource, type Random } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import {
  confirmationStoreContract,
  type ConfirmationStoreSubject,
} from "../contracts/confirmation-store-contract.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createStoredIntents, type IntentSnapshot } from "./create-stored-intents.js";
import type { IntentMove } from "./intent-change-of.js";
import { quoteDocument } from "./intent-documents.schema.js";
import {
  heldConfirmations,
  heldIntent,
  heldIntentId,
  type HeldIntents,
  holdIntent,
  unknownIntentId,
} from "./test-confirmations.js";
import {
  expectOk,
  testAgent,
  testAgentDraft,
  testNowMs,
  testSwap,
  testWallet,
} from "./test-intents.js";

const live = { signal: new AbortController().signal };
const intent = heldIntentId;
const unknown = unknownIntentId;
const held = heldIntent;

function holding(random?: Random): HeldIntents {
  const stores = createMemoryEngineStores();
  const placeAgent = async (): Promise<void> => {
    await stores.agents.create(testAgentDraft(), live);
  };
  return holdIntent({ intents: stores.intents, agents: stores.agents, placeAgent }, random);
}

function memoryConfirmations(): ConfirmationStoreSubject {
  const stores = createMemoryEngineStores();
  const placeAgent = async (): Promise<void> => {
    await stores.agents.create(testAgentDraft(), live);
  };
  return heldConfirmations({ intents: stores.intents, agents: stores.agents, placeAgent });
}

function moveTo(
  stored: StoredIntent,
  status: Partial<StoredIntent["status"]>,
  atMs: number,
): IntentMove {
  const next = { ...stored.status, ...status, changedAtMs: atMs };
  return {
    intent,
    version: stored.version,
    step: {
      status: next,
      event: {
        from: stored.status.state,
        to: next.state,
        trigger: "confirm_requoted",
        atMs,
        hasLedgerEntry: false,
      },
    },
  };
}

describe("stored intents", () => {
  it.each(
    confirmationStoreContract({
      create: memoryConfirmations,
    }),
  )("follow the confirmation store contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("push a new intent, each move, the cards it opens and closes, and the ledger", async () => {
    const { pushes, ready } = holding();
    await ready;
    expect(pushes.map((push) => push.kind)).toStrictEqual([
      "intent/created",
      "ledger/appended",
      "intent/changed",
      "card/opened",
      "ledger/appended",
    ]);
    expect(pushes[2]?.data).toStrictEqual({
      intent,
      agent: testAgent,
      state: "awaiting_confirmation",
      version: 1,
      changedAt: 10_000,
    });
  });

  it("open the next card version and close the open one as replaced", async () => {
    const { stored, pushes, ready } = holding();
    await ready;
    const card = { version: 2, openedAtMs: 20_000, expiresAtMs: 80_000 };
    const moved = await stored.move(moveTo(held, { card }, 20_000), live);
    const { cards } = expectOk(moved).history;
    expect(cards.map((opened) => [opened.version, opened.closeReason])).toStrictEqual([
      [1, "replaced"],
      [2, undefined],
    ]);
    expect(pushes.slice(-2).map((push) => push.kind)).toStrictEqual(["card/closed", "card/opened"]);
  });

  it("give each card version a random callback reference, and none without a random source", async () => {
    const { stored, ready } = holding(createSeededRandom(6));
    await ready;
    const card = { version: 2, openedAtMs: 20_000, expiresAtMs: 80_000 };
    const moved = await stored.move(moveTo(held, { card }, 20_000), live);
    const refs = expectOk(moved).history.cards.map((opened) => opened.callbackRef);
    expect(refs).toStrictEqual([
      expect.stringMatching(/^[\w-]{16}$/),
      expect.stringMatching(/^[\w-]{16}$/),
    ]);
    expect(new Set(refs).size).toBe(2);
    const plain = holding();
    await plain.ready;
    const snapshot = await plain.stored.snapshot(intent, live);
    expect(snapshot?.history.cards.map((opened) => opened.callbackRef)).toStrictEqual([undefined]);
  });

  it("close the open card when the intent is cancelled", async () => {
    const { stored, ready } = holding();
    await ready;
    const moved = await stored.move(moveTo(held, { state: "cancelled" }, 20_000), live);
    expect(expectOk(moved).history.cards[0]?.closeReason).toBe("cancelled");
  });

  it("answer an id in use as exists and an unknown intent as undefined", async () => {
    const { stored, ready } = holding();
    await ready;
    const snapshot: IntentSnapshot | undefined = await stored.snapshot(intent, live);
    const again = await stored.create(
      {
        id: intent,
        agentId: testAgent,
        walletId: testWallet,
        request: testSwap(),
        proposerRef: "engine",
        step: {
          status: held.status,
          event: { from: null, to: "proposed", trigger: "propose", atMs: 1, hasLedgerEntry: false },
        },
      },
      live,
    );
    expect(again).toStrictEqual({ ok: false, error: "exists" });
    expect(snapshot?.record.version).toBe(1);
    await expect(stored.snapshot(unknown, live)).resolves.toBeUndefined();
  });

  it("refuse a confirmation that no Confirm closed its card with", async () => {
    const { stored, ready } = holding();
    await ready;
    const write = {
      ...moveTo(held, { state: "confirmed" }, 20_000),
      confirmation: { cardVersion: 1, expiresAtMs: 70_000 },
    };
    await expect(stored.move(write, live)).rejects.toMatchObject({
      code: "engine.bad_confirmation",
    });
  });

  it("fault on an intent whose first event names no proposer, or whose agent is missing", async () => {
    const stores = createMemoryEngineStores();
    const ids = createIdSource({
      clock: createManualClock(testNowMs),
      random: createSeededRandom(5),
    });
    const stored = createStoredIntents({
      intents: stores.intents,
      agents: stores.agents,
      ids,
      publish: () => undefined,
    });
    const draft = {
      id: intent,
      agentId: testAgent,
      walletId: testWallet,
      kind: "swap",
      state: "proposed",
      request: {},
      hasOutsideContent: false,
      isPaper: true,
      proposer: "engine",
      atMs: 1_000,
      cause: { trigger: "propose" },
    } as const;
    await stores.intents.create(draft, live);
    await expect(stored.snapshot(intent, live)).rejects.toMatchObject({
      code: "engine.agent_missing",
    });
    await stores.agents.create(testAgentDraft(), live);
    await expect(stored.snapshot(intent, live)).rejects.toMatchObject({
      code: "engine.bad_document",
    });
  });

  it("fault on a stored document that breaks its schema", () => {
    expect(() => quoteDocument.decode({ quotedAt: "soon" })).toThrow(
      expect.objectContaining({ code: "engine.bad_document" }),
    );
  });
});
