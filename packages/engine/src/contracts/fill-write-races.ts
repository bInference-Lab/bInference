import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { OrderFillWrite } from "../orders/order-fill.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import {
  answerOf,
  conflict,
  firstOf,
  type MoneyRaceSubject,
  type MoneyWriter,
  race,
  settled,
} from "./money-race-runs.js";
import { activeOrder, fillRow } from "./order-fill-checks.js";
import { orderMove } from "./order-fixtures.js";
import { fixtureId, inOrder, live } from "./store-fixtures.js";

/**
 * The three writes that count a live fill on its order (decision 0211): the landed fill alone,
 * the intent move that reconciles it, and its late landing.
 */
export type FillPath = "land" | "reconcile" | "late";

/** What a write that counts a fill answered: `ok`, its refusal, or a give-up on conflicts. */
export type FillAnswer = "ok" | "counted" | "stale" | "exists" | "not_found" | typeof conflict;

/** Intent `n`'s fill: the order write that counts it, and the transaction a late landing names. */
export interface FillCount {
  readonly n: number;
  readonly write: OrderFillWrite;
  readonly txId: Id<"tx">;
}

// A reconcile moves the intent from version 0, as the executor moves it from the snapshot it read.
const writesBy: Readonly<
  Record<FillPath, (writer: MoneyWriter, count: FillCount) => Promise<FillAnswer>>
> = {
  land: async (writer, { write }) =>
    answerOf(await settled(writer.orders.recordLandedFill(write, live()))),
  reconcile: async (writer, { n, write }) => {
    const move = { ...intentMove(n, 0, "reconciled"), order: write };
    return answerOf(await settled(writer.intents.transition(move, live())));
  },
  late: async (writer, { n, write, txId }) => {
    const landing = { intentId: fixtureId("int", n), txId, atMs: 9_000, order: write };
    return answerOf(await settled(writer.intents.recordLandedLate(landing, live())));
  },
};

/** Counts intent `n`'s fill on its order by `path`, from the order write the caller built. */
export async function countFillBy(
  writer: MoneyWriter,
  path: FillPath,
  count: FillCount,
): Promise<FillAnswer> {
  return writesBy[path](writer, count);
}

const paths: readonly FillPath[] = ["land", "reconcile", "late"];

// Writer `index`'s path and intent: two intents per path, from 3, so writers of one path race on
// one intent too, and writers of different paths only on the order.
function plannedOf(index: number): { readonly path: FillPath; readonly n: number } {
  const place = index % paths.length;
  const path = paths[place] ?? "land";
  return { path, n: 3 + place * 2 + (Math.floor(index / paths.length) % 2) };
}

/**
 * Writers that count fills on one order at once, by all three writes, each built from the order
 * at the version it read, some the same intent's and some others', count exactly one: one
 * `filled` row, one fill more on the order, and every other write answers its refusal.
 */
export async function countsOneLandedFill(subject: MoneyRaceSubject): Promise<void> {
  const { intents, orders } = firstOf(subject);
  await activeOrder({ ...subject, store: orders, intents }, 1);
  const fillIntents = [3, 4, 5, 6, 7, 8];
  await inOrder(fillIntents, async (n) => intents.create(intentDraft(subject, n), live()));
  const answers = await race(subject, async (writer, index) => {
    const { path, n } = plannedOf(index);
    const fill = { ...fillRow(1, 10 + index, "filled"), intentId: fixtureId("int", n) };
    const write = { moves: [{ ...orderMove(1, 1, "active"), fills: 1 }], fill };
    return countFillBy(writer, path, { n, write, txId: fixtureId("tx", index + 1) });
  });
  for (const answer of answers) {
    assert.ok(["ok", "stale", "counted", "exists", conflict].includes(answer), answer);
  }
  assert.equal(answers.filter((answer) => answer === "ok").length, 1);
  assert.equal((await orders.get(fixtureId("ord", 1), live()))?.fills, 1);
  const filled = await orders.fills({ orderId: fixtureId("ord", 1), limit: 50 }, live());
  assert.equal(filled.length, 1);
  const counted = await inOrder(fillIntents, async (n) =>
    orders.countedFill(fixtureId("int", n), live()),
  );
  assert.deepEqual(
    counted.filter((row) => row !== undefined),
    filled,
  );
}
