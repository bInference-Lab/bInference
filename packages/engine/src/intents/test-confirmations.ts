// The intent the confirmation store's contract holds, stored through the intent and agent stores
// a test gives, so the engine's fakes and each store adapter run the suite on one fixture. Nothing
// in production uses this file.
import { bpsSchema, createIdSource, type Id, idSchema, type Random } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { QuoteView } from "@binference/protocol";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import type { ConfirmationStoreSubject } from "../contracts/confirmation-store-contract.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createStoredIntents, type StoredIntents } from "./create-stored-intents.js";
import type { IntentMove } from "./intent-change-of.js";
import { quoteDocument } from "./intent-documents.schema.js";
import { testCoin, testNewIntent, testNowMs, testToken } from "./test-intents.js";

const live = { signal: new AbortController().signal };

/** The intent the fixture holds. */
export const heldIntentId: Id<"int"> = idSchema("int").parse(
  "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);
/** An intent id the fixture never stores. */
export const unknownIntentId: Id<"int"> = idSchema("int").parse(
  "int_0190f1c2-3a4b-7c5d-8e6f-000000000009",
);

const quote: QuoteView = {
  route: [],
  amountIn: { asset: testCoin, base: 1_000_000n },
  expectedOut: { asset: testToken, base: 1_010_000n },
  minOut: { asset: testToken, base: 1_000_000n },
  priceImpactBps: bpsSchema.parse(10),
  gas: { asset: testCoin, base: 0n },
  quotedAt: 9_000,
  expiresAt: 69_000,
};

/** The intent every check holds: awaiting its first card, on version 1. */
export const heldIntent: StoredIntent = {
  intent: heldIntentId,
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
    requoteToleranceBps: bpsSchema.parse(50),
  },
};

/** Stored intents over a test's stores, with the held intent being stored. */
export interface HeldIntents {
  readonly stored: StoredIntents;
  readonly pushes: readonly EnginePush[];
  /** Resolves once the agent and the held intent are stored. */
  readonly ready: Promise<void>;
}

/** What {@link holdIntent} stores through. */
export interface HoldingStores {
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  /** Stores the test agent and its wallet, as the test's database does it. */
  readonly placeAgent: () => Promise<void>;
}

async function seed(stored: StoredIntents, stores: HoldingStores): Promise<void> {
  await stores.placeAgent();
  await stored.create(testNewIntent(heldIntentId), live);
  const toHeld: IntentMove = {
    intent: heldIntentId,
    version: 0,
    step: {
      status: heldIntent.status,
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

/** Starts storing the held intent through `stores`, its card references from `random`. */
export function holdIntent(stores: HoldingStores, random?: Random): HeldIntents {
  const pushes: EnginePush[] = [];
  const ids = createIdSource({
    clock: createManualClock(testNowMs),
    random: createSeededRandom(5),
  });
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids,
    ...(random === undefined ? {} : { random }),
    publish: (push) => pushes.push(push),
  });
  return { stored, pushes, ready: seed(stored, stores) };
}

/**
 * The confirmation store's contract subject over `stores`. The contract's checks start at once,
 * so each call waits for the held intent to be stored.
 */
export function heldConfirmations(stores: HoldingStores): ConfirmationStoreSubject {
  const { stored, ready } = holdIntent(stores);
  return {
    store: {
      read: async (id, options) => {
        await ready;
        return stored.read(id, options);
      },
      write: async (write, options) => {
        await ready;
        return stored.write(write, options);
      },
    },
    held: heldIntent,
    unknown: unknownIntentId,
  };
}
