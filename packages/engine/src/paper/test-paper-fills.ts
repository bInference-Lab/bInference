import type { PriceSource, UsdPrice } from "@binference/chain";
import { bpsSchema, createIdSource, type Id, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
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
  testWallet,
} from "../intents/test-intents.js";
import type { IntentStore, PositionStore } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { createPaperFills, type PaperFills } from "./paper-fills.js";

const live = { signal: new AbortController().signal };

/** The paper swap the tests fill. */
export const paperIntent: Id<"int"> = idSchema("int").parse(
  "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);

/** The clock the fills read, at the test intents' time. */
export const paperClock: ManualClock = createManualClock(testNowMs);

/** $600 a coin: 600 dollars in micro-dollars for 10^18 base units. */
export const coinPrice: UsdPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };

/** A paper swap stored, its stores and its paper positions. */
export interface Held {
  readonly intents: IntentStore;
  readonly stored: StoredIntents;
  readonly snapshot: IntentSnapshot;
  readonly positions: PositionStore;
}

/** The paper swap's state, quote and the portfolio it fills from. */
export interface Holding {
  readonly state: "proposed" | "confirmed";
  readonly isQuoted?: boolean;
  /** The coin the paper portfolio starts with; one coin when absent. */
  readonly coinBase?: bigint;
  /** The coin the confirmed quote spends; a tenth of a coin when absent. */
  readonly amountInBase?: bigint;
}

function quoteOf(amountInBase: bigint) {
  return quoteDocument.encode({
    route: [],
    amountIn: { asset: testCoin, base: amountInBase },
    expectedOut: { asset: testToken, base: 2_000_000n },
    minOut: { asset: testToken, base: 1_990_000n },
    priceImpactBps: bpsSchema.parse(0),
    gas: { asset: testCoin, base: 0n },
    quotedAt: testNowMs,
    expiresAt: testNowMs,
  });
}

/**
 * A paper swap stored in `proposed`, then moved straight to `confirmed` when asked, with its quote
 * when quoted, on a paper portfolio of `coinBase` of the coin.
 */
export async function holding(options: Holding): Promise<Held> {
  const { state, isQuoted = true, coinBase = 10n ** 18n, amountInBase = 10n ** 17n } = options;
  const stores = createMemoryEngineStores();
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids: createIdSource({ clock: paperClock, random: createSeededRandom(13) }),
    publish: () => undefined,
  });
  await stores.agents.create(testAgentDraft(), live);
  const proposed = testNewIntent(paperIntent);
  await stored.create(proposed, live);
  const { status } = proposed.step;
  const event = {
    from: "proposed",
    to: state,
    trigger: "authorization_checked",
    atMs: testNowMs,
    hasLedgerEntry: true,
  } as const;
  const step = { status: { ...status, state }, event };
  const fields = isQuoted ? { quote: quoteOf(amountInBase) } : {};
  await stored.move({ intent: paperIntent, version: 0, step, fields }, live);
  const snapshot = await stored.snapshot(paperIntent, live);
  if (snapshot === undefined) {
    throw new Error("Expected the intent to be stored.");
  }
  const positions = createMemoryPositionStore();
  // A portfolio of none of the coin starts with no position at all.
  const balances = coinBase > 0n ? [{ asset: testCoin, base: coinBase }] : [];
  const prices = createFakePriceSource(new Map([[testCoin, coinPrice]]));
  await createPositions({ store: positions, prices }).resetPaper(
    { walletId: testWallet, atMs: testNowMs, balances },
    live,
  );
  return { intents: stores.intents, stored, snapshot, positions };
}

/** The paper fills over a held intent's stores, its portfolio read from its paper positions. */
export function fillsOn(
  { stored, positions }: Pick<Held, "stored" | "positions">,
  prices: PriceSource = createFakePriceSource(new Map([[testCoin, coinPrice]])),
): PaperFills {
  return createPaperFills({
    stored,
    positions: createPositions({ store: positions, prices }),
    portfolio: {
      async balance(wallet, asset, call) {
        const held = await positions.positions({ walletId: wallet, isPaper: true }, call);
        return held.find((position) => position.asset === asset)?.quantityBase ?? 0n;
      },
    },
    prices,
    clock: paperClock,
  });
}
