import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { paperFillOf } from "../intents/intent-history.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import type { PositionStore } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { paperRepairWindowMs, repairPaperFills } from "./repair-paper-fills.js";
import {
  coinPrice,
  fillsOn,
  type Held,
  holding,
  paperIntent as intent,
  paperClock as clock,
} from "./test-paper-fills.js";

const live = { signal: new AbortController().signal };
const paperQuery = { walletId: testWallet, isPaper: true };

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

  it("end a paper swap whose portfolio holds less than its input as nothing to sell", async () => {
    const held = await holding({ state: "confirmed", coinBase: 10n ** 17n - 1n });
    const ended = await fillsOn(held).fillAtQuote(held.snapshot, live);
    expect([ended.record.state, ended.record.reason]).toStrictEqual([
      "failed_check",
      "nothing_to_sell",
    ]);
    expect(
      await held.positions.executions({ after: 0, limit: 5, isPaper: true }, live),
    ).toHaveLength(0);
  });

  it("fill a paper swap whose portfolio holds exactly its input", async () => {
    const held = await holding({ state: "confirmed", coinBase: 10n ** 17n });
    const filled = await fillsOn(held).fillAtQuote(held.snapshot, live);
    expect(filled.record.state).toBe("paper_filled");
    const positions = await held.positions.positions(paperQuery, live);
    expect(positions).toContainEqual(
      expect.objectContaining({ asset: testCoin, quantityBase: 0n }),
    );
  });

  it("answer with the intent as another write left it when the short end loses its race", async () => {
    const held = await holding({ state: "confirmed", coinBase: 0n });
    const losingMove: StoredIntents = {
      ...held.stored,
      move: async () => await Promise.resolve(err("stale")),
    };
    const fills = fillsOn({ ...held, stored: losingMove });
    await expect(fills.fillAtQuote(held.snapshot, live)).resolves.toStrictEqual(held.snapshot);
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
