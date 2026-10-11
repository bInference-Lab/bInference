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
import { paperFillOf } from "../intents/intent-history.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
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
import { paperRepairWindowMs, repairPaperFills } from "./repair-paper-fills.js";

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
  readonly intents: IntentStore;
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
  return { intents: stores.intents, stored, snapshot, positions };
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

  it("value a sold asset the source cannot price at the confirmed quote's price", async () => {
    const held = await holding({ state: "confirmed" });
    // $30 a million token units: the quote's 2,000,000 units are worth $60.
    const tokenPrice = { numerator: 30n, denominator: 1n };
    const tokenOnly = fillsOn(held, createFakePriceSource(new Map([[testToken, tokenPrice]])));
    expect((await tokenOnly.fillAtQuote(held.snapshot, live)).record.state).toBe("paper_filled");
    const executions = await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live);
    expect(executions.map((row) => row.valueUsdMicros)).toStrictEqual([60_000_000n]);
  });

  it("stay confirmed, with nothing written, when neither side of the quote has a price", async () => {
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

// A position store that dies on its first execution write, as a crash right after the fill does.
function crashing(store: PositionStore): PositionStore {
  return {
    ...store,
    record: async () => Promise.reject(new Error("The engine stopped.")),
  };
}

function repairOn(held: Held, nowMs = testNowMs) {
  // Prices moved since the fill: the repair values it at the fill's own price.
  const prices = createFakePriceSource(new Map([[testCoin, { ...coinPrice, numerator: 1n }]]));
  const repairClock = { ...clock, now: () => nowMs };
  return repairPaperFills(
    {
      intents: held.intents,
      stored: held.stored,
      store: held.positions,
      positions: createPositions({ store: held.positions, prices }),
      clock: repairClock,
    },
    live,
  );
}

async function crashedFill(): Promise<Held> {
  const held = await holding({ state: "confirmed" });
  const fills = fillsOn({ ...held, positions: crashing(held.positions) });
  await expect(fills.fillAtQuote(held.snapshot, live)).rejects.toThrow("The engine stopped.");
  expect((await held.stored.snapshot(intent, live))?.record.state).toBe("paper_filled");
  return held;
}

function fillStep(snapshot: IntentSnapshot) {
  const step = createIntentStateMachine({ clock }).apply(snapshot.stored.status, {
    type: "paper_fill_recorded",
  });
  if (!step.ok) {
    throw new Error("Expected a confirmed intent to fill.");
  }
  return step.value;
}

async function storedFill(held: Held) {
  const snapshot = await held.stored.snapshot(intent, live);
  return snapshot === undefined ? undefined : paperFillOf(snapshot.history);
}

describe("the repair of paper fills at start", () => {
  it("records the positions a crash after the fill left out, at the fill's price", async () => {
    const held = await crashedFill();
    expect(
      await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(0);
    await expect(repairOn(held)).resolves.toBe(1);
    const executions = await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live);
    expect(executions).toMatchObject([
      { intentId: intent, valueUsdMicros: 60_000_000n, atMs: testNowMs, gasUsdMicros: 0n },
    ]);
    const positions = await held.positions.positions(paperQuery, live);
    expect(positions.map((row) => [row.asset, row.quantityBase])).toStrictEqual([
      [testCoin, 9n * 10n ** 17n],
      [testToken, 2_000_000n],
    ]);
  });

  it("changes nothing for a fill whose positions are recorded, nor on a second run", async () => {
    const held = await holding({ state: "confirmed" });
    await fillsOn(held).fillAtQuote(held.snapshot, live);
    await expect(repairOn(held)).resolves.toBe(0);
    const crashed = await crashedFill();
    await expect(repairOn(crashed)).resolves.toBe(1);
    await expect(repairOn(crashed)).resolves.toBe(0);
    expect(
      await crashed.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(1);
  });

  it("leaves a fill recorded before fills kept their price", async () => {
    const held = await holding({ state: "confirmed" });
    const fill = {
      amountIn: { asset: testCoin, base: 10n ** 17n },
      amountOut: { asset: testToken, base: 2_000_000n },
      atMs: testNowMs,
    };
    const move = { intent, version: held.snapshot.stored.version, by: "engine", fill } as const;
    await held.stored.move({ ...move, step: fillStep(held.snapshot) }, live);
    expect((await held.stored.snapshot(intent, live))?.record.state).toBe("paper_filled");
    await expect(repairOn(held)).resolves.toBe(0);
  });

  it("leaves a fill older than its window", async () => {
    const held = await crashedFill();
    await expect(repairOn(held, testNowMs + paperRepairWindowMs + 2)).resolves.toBe(0);
  });

  it("keeps the price a fill was valued at with the fill", async () => {
    const held = await crashedFill();
    expect(await storedFill(held)).toStrictEqual({
      amountIn: { asset: testCoin, base: 10n ** 17n },
      amountOut: { asset: testToken, base: 2_000_000n },
      atMs: testNowMs,
      soldPrice: coinPrice,
    });
  });
});
