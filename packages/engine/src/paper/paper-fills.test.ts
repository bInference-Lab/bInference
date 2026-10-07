import { createIdSource, err, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
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
import type { PositionStore } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { createPaperFills, type PaperFills } from "./paper-fills.js";

const live = { signal: new AbortController().signal };
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const clock = createManualClock(testNowMs);
// $600 a coin: 600 dollars in micro-dollars for 10^18 base units.
const coinPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const paperQuery = { walletId: testWallet, isPaper: true };
const quote = quoteDocument.encode({
  route: [],
  amountIn: { asset: testCoin, base: 10n ** 17n },
  expectedOut: { asset: testToken, base: 2_000_000n },
  minOut: { asset: testToken, base: 1_990_000n },
  priceImpactBps: 0 as never,
  gas: { asset: testCoin, base: 0n },
  quotedAt: testNowMs,
  expiresAt: testNowMs,
});

interface Held {
  readonly stored: StoredIntents;
  readonly snapshot: IntentSnapshot;
  readonly positions: PositionStore;
}

interface Holding {
  readonly state: "proposed" | "confirmed";
  readonly isQuoted?: boolean;
}

// A paper swap stored in `proposed`, then moved straight to `confirmed` when asked, with its quote
// when quoted, on a paper portfolio of one coin.
async function holding({ state, isQuoted = true }: Holding): Promise<Held> {
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
  const step = { status: { ...status, state }, event };
  const fields = isQuoted ? { quote } : {};
  await stored.move({ intent, version: 0, step, fields }, live);
  const snapshot = await stored.snapshot(intent, live);
  if (snapshot === undefined) {
    throw new Error("Expected the intent to be stored.");
  }
  const positions = createMemoryPositionStore();
  const balances = [{ asset: testCoin, base: 10n ** 18n }];
  const prices = createFakePriceSource(new Map([[testCoin, coinPrice]]));
  await createPositions({ store: positions, prices }).resetPaper(
    { walletId: testWallet, atMs: testNowMs, balances },
    live,
  );
  return { stored, snapshot, positions };
}

function fillsOn(
  { stored, positions }: Pick<Held, "stored" | "positions">,
  prices = createFakePriceSource(new Map([[testCoin, coinPrice]])),
): PaperFills {
  return createPaperFills({
    stored,
    positions: createPositions({ store: positions, prices }),
    prices,
    clock,
  });
}

// A position store whose first `losses` executions lose their race to another fill.
function losing(store: PositionStore, losses: number): PositionStore {
  let lost = 0;
  return {
    ...store,
    async record(write, options) {
      if (lost < losses) {
        lost += 1;
        return await Promise.resolve(err("stale"));
      }
      return store.record(write, options);
    },
  };
}

describe("paper fills", () => {
  it("leave an intent the state machine does not let fill as it was", async () => {
    const held = await holding({ state: "proposed" });
    await expect(fillsOn(held).fillAtQuote(held.snapshot, live)).resolves.toBe(held.snapshot);
  });

  it("fault on a confirmed paper intent with no quote to fill at", async () => {
    const held = await holding({ state: "confirmed", isQuoted: false });
    await expect(fillsOn(held).fillAtQuote(held.snapshot, live)).rejects.toMatchObject({
      code: "engine.no_quote",
    });
  });

  it("move the paper portfolio at the quote, the coin sold at its price then", async () => {
    const held = await holding({ state: "confirmed" });
    const filled = await fillsOn(held).fillAtQuote(held.snapshot, live);
    expect(filled.record.state).toBe("paper_filled");
    const executions = await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live);
    expect(executions).toMatchObject([
      {
        intentId: intent,
        walletId: testWallet,
        sold: { asset: testCoin, base: 10n ** 17n },
        bought: { asset: testToken, base: 2_000_000n },
        gas: { asset: testCoin, base: 0n },
        feeBase: 0n,
        valueUsdMicros: 60_000_000n,
        gasUsdMicros: 0n,
        atMs: testNowMs,
      },
    ]);
    const positions = await held.positions.positions(paperQuery, live);
    expect(positions.map((row) => [row.asset, row.quantityBase, row.costUsdMicros])).toStrictEqual([
      [testCoin, 9n * 10n ** 17n, 540_000_000n],
      [testToken, 2_000_000n, 60_000_000n],
    ]);
  });

  it("stay confirmed, with nothing written, when the sold coin has no price", async () => {
    const held = await holding({ state: "confirmed" });
    const unpriced = fillsOn(held, createFakePriceSource(new Map()));
    await expect(unpriced.fillAtQuote(held.snapshot, live)).resolves.toBe(held.snapshot);
    expect((await held.stored.snapshot(intent, live))?.record.state).toBe("confirmed");
    expect(
      await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(0);
  });

  it("answer with the intent as another write left it when the fill loses its race", async () => {
    const held = await holding({ state: "confirmed" });
    const losingMove: StoredIntents = {
      ...held.stored,
      move: async () => await Promise.resolve(err("stale")),
    };
    const fills = fillsOn({ ...held, stored: losingMove });
    await expect(fills.fillAtQuote(held.snapshot, live)).resolves.toStrictEqual(held.snapshot);
    expect(
      await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(0);
  });

  it("read the positions again when another fill moved them first", async () => {
    const held = await holding({ state: "confirmed" });
    const fills = fillsOn({ ...held, positions: losing(held.positions, 2) });
    expect((await fills.fillAtQuote(held.snapshot, live)).record.state).toBe("paper_filled");
    expect(
      await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(1);
  });

  it("fault once the position write lost its race three times", async () => {
    const held = await holding({ state: "confirmed" });
    const fills = fillsOn({ ...held, positions: losing(held.positions, 3) });
    await expect(fills.fillAtQuote(held.snapshot, live)).rejects.toMatchObject({
      code: "engine.positions_stale",
      retryable: true,
    });
  });
});
