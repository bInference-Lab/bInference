import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { QuoteView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import { confirmationStoreContract } from "../contracts/confirmation-store-contract.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import type { ConfirmationStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import {
  createStoredIntents,
  type IntentSnapshot,
  type StoredIntents,
} from "./create-stored-intents.js";
import type { IntentMove } from "./intent-change-of.js";
import { quoteDocument } from "./intent-documents.schema.js";
import {
  expectOk,
  testAgent,
  testAgentDraft,
  testCoin,
  testNewIntent,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "./test-intents.js";

const live = { signal: new AbortController().signal };
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const unknown = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;
const quote: QuoteView = {
  route: [],
  amountIn: { asset: testCoin, base: 1_000_000n },
  expectedOut: { asset: testToken, base: 1_010_000n },
  minOut: { asset: testToken, base: 1_000_000n },
  priceImpactBps: 10 as never,
  gas: { asset: testCoin, base: 0n },
  quotedAt: 9_000,
  expiresAt: 69_000,
};

/** The intent every check holds: awaiting its first card, on version 1. */
const held: StoredIntent = {
  intent,
  status: {
    state: "awaiting_confirmation",
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: true,
    hasOutsideContent: false,
    changedAtMs: 10_000,
    quote: { quotedAtMs: 9_000, minOutBase: 1_000_000n },
    card: { version: 1, openedAtMs: 10_000, expiresAtMs: 70_000 },
  },
  version: 1,
  cards: {
    tradeExpiryMs: 60_000,
    otherExpiryMs: 600_000,
    requoteAfterMs: 10_000,
    requoteToleranceBps: 50 as never,
  },
};

interface Held {
  readonly stored: StoredIntents;
  readonly pushes: readonly EnginePush[];
  /** Resolves once the agent and the held intent are stored. */
  readonly ready: Promise<void>;
}

async function seed(stored: StoredIntents, stores: ReturnType<typeof createMemoryEngineStores>) {
  await stores.agents.create(testAgentDraft(), live);
  await stored.create(testNewIntent(intent), live);
  const toHeld: IntentMove = {
    intent,
    version: 0,
    step: {
      status: held.status,
      event: {
        from: "proposed",
        to: "awaiting_confirmation",
        trigger: "authorization_checked",
        atMs: 10_000,
        hasLedgerEntry: true,
      },
    },
    fields: { quote: quoteDocument.encode(quote) },
  };
  await stored.move(toHeld, live);
}

function holding(): Held {
  const stores = createMemoryEngineStores();
  const pushes: EnginePush[] = [];
  const ids = createIdSource({
    clock: createManualClock(testNowMs),
    random: createSeededRandom(5),
  });
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids,
    publish: (push) => pushes.push(push),
  });
  return { stored, pushes, ready: seed(stored, stores) };
}

// The contract's checks start at once; each call waits for the held intent to be stored.
function afterSeeding({ stored, ready }: Held): ConfirmationStore {
  return {
    read: async (id, options) => {
      await ready;
      return stored.read(id, options);
    },
    write: async (write, options) => {
      await ready;
      return stored.write(write, options);
    },
  };
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
      create: () => ({ store: afterSeeding(holding()), held, unknown }),
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
