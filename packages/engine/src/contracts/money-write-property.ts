import assert from "node:assert/strict";
import { BinferenceError, type Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import * as fc from "fast-check";
import { genesisLedgerHash, hashLedgerEntry } from "../ledger/ledger-hash.js";
import type { OrderFillRecord } from "../orders/order-fill.js";
import { countFillBy, type FillAnswer, type FillPath } from "./fill-write-races.js";
import { intentDraft } from "./intent-fixtures.js";
import {
  firstOf,
  type MoneyRaceHarness,
  type MoneyRaceSubject,
  type MoneyWriter,
  race,
} from "./money-race-runs.js";
import { confirmedCard, orderDraft, orderMove } from "./order-fixtures.js";
import { fixtureId, inOrder, live } from "./store-fixtures.js";

// Writers race to count the landed fills of six intents on two orders, by each of the three writes
// that count one, and to append to the ledger, each step read then written as the executor does.

const orderNumbers = [1, 2] as const;

// Two intents per write, so the writers of one write race on one intent's fill.
const intentsBy: Readonly<Record<FillPath, readonly number[]>> = {
  land: [11, 12],
  reconcile: [13, 14],
  late: [15, 16],
};

type Step =
  | {
      readonly kind: "count";
      readonly path: FillPath;
      readonly intent: number;
      readonly order: number;
    }
  | { readonly kind: "append" };

const countStep = (path: FillPath): fc.Arbitrary<Step> =>
  fc.record({
    kind: fc.constant("count" as const),
    path: fc.constant(path),
    intent: fc.constantFrom(...intentsBy[path]),
    order: fc.constantFrom(...orderNumbers),
  });

const step: fc.Arbitrary<Step> = fc.oneof(
  countStep("land"),
  countStep("reconcile"),
  countStep("late"),
  fc.record({ kind: fc.constant("append" as const) }),
);

/** Each writer's steps, in its own order. */
const plans: fc.Arbitrary<readonly (readonly Step[])[]> = fc.array(
  fc.array(step, { minLength: 1, maxLength: 3 }),
  { minLength: 8, maxLength: 8 },
);

interface Landed {
  readonly fill: OrderFillRecord;
  readonly answer: FillAnswer;
}

async function prepare(subject: MoneyRaceSubject, writer: MoneyWriter): Promise<void> {
  const parts = { ...subject, store: writer.orders, intents: writer.intents };
  await inOrder([...orderNumbers], async (n) => {
    const card = await confirmedCard(parts, n);
    assert.ok((await writer.orders.create({ ...orderDraft(subject, n), maxFills: 10 }, live())).ok);
    assert.ok(
      (await writer.orders.move([{ ...orderMove(n, 0, "active"), cardId: card }], live())).ok,
    );
  });
  await inOrder(Object.values(intentsBy).flat(), async (n) =>
    writer.intents.create(intentDraft(subject, n), live()),
  );
}

// Reads the order, then counts the fill on it by its write, from what it read.
async function count(
  writer: MoneyWriter,
  planned: Extract<Step, { kind: "count" }>,
  n: number,
): Promise<Landed> {
  const fill: OrderFillRecord = {
    id: fixtureId("fil", n),
    orderId: fixtureId("ord", planned.order),
    outcome: "filled",
    atMs: 5_000 + n,
    intentId: fixtureId("int", planned.intent),
  };
  const order = await writer.orders.get(fill.orderId, live());
  assert.ok(order !== undefined);
  const move = { ...orderMove(planned.order, order.version, "active"), fills: order.fills + 1 };
  const write = { moves: [move], fill };
  const txId = fixtureId("tx", n);
  return {
    fill,
    answer: await countFillBy(writer, planned.path, { n: planned.intent, write, txId }),
  };
}

// A write that gave up on conflicts wrote nothing; any other fault fails the run.
function throwUnlessConflict(error: Error["cause"]): void {
  if (!(error instanceof BinferenceError && error.code === "store.write_conflict")) {
    throw error;
  }
}

// Entry ids past the fixtures' own, which number from `100 * n` for intent `n`.
async function append(writer: MoneyWriter, n: number): Promise<readonly Id<"led">[]> {
  const draft = {
    id: fixtureId("led", 90_000 + n),
    atMs: 5_000 + n,
    kind: "proposed",
    data: { n },
  };
  try {
    await writer.ledger.append(draft, live());
    return [draft.id];
  } catch (error) {
    throwUnlessConflict(error);
    return [];
  }
}

async function assertBookedOnce(
  subject: MoneyRaceSubject,
  landed: readonly Landed[],
): Promise<void> {
  const writer = firstOf(subject);
  for (const { answer } of landed) {
    assert.ok(["ok", "stale", "counted", "exists", "conflict"].includes(answer), answer);
  }
  const rows = (
    await inOrder([...orderNumbers], async (n) =>
      writer.orders.fills({ orderId: fixtureId("ord", n), limit: 100 }, live()),
    )
  ).flat();
  const won = landed.filter(({ answer }) => answer === "ok").map(({ fill }) => fill);
  assert.deepEqual(rows.map(({ id }) => id).toSorted(), won.map(({ id }) => id).toSorted());
  const intents = rows.map(({ intentId }) => intentId);
  assert.equal(new Set(intents).size, intents.length, "an intent's fill was counted twice");
  await inOrder([...orderNumbers], async (n) => {
    const order = await writer.orders.get(fixtureId("ord", n), live());
    assert.equal(
      order?.fills,
      rows.filter(({ orderId }) => orderId === fixtureId("ord", n)).length,
    );
  });
}

async function assertAppendedOnce(
  subject: MoneyRaceSubject,
  appended: readonly string[],
): Promise<void> {
  const entries = await firstOf(subject).ledger.list({ after: 0, limit: 1_000 }, live());
  let previous = genesisLedgerHash;
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.seq, index + 1);
    assert.equal(entry.hash, hashLedgerEntry(previous, entry));
    previous = entry.hash;
  }
  const ids = entries.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "a ledger entry was written twice");
  const raced = ids.filter((id) => id >= fixtureId("led", 90_000));
  assert.deepEqual(raced.toSorted(), appended.toSorted());
}

// Writer `index`'s steps, each with its place in the writer's own order.
function stepsOf(
  plan: readonly (readonly Step[])[],
  index: number,
): readonly { readonly planned: Step; readonly k: number }[] {
  const steps = plan[index % plan.length];
  assert.ok(steps !== undefined);
  return steps.map((planned, k) => ({ planned, k }));
}

async function runPlan(
  harness: MoneyRaceHarness,
  plan: readonly (readonly Step[])[],
): Promise<void> {
  const subject = await harness.create();
  await prepare(subject, firstOf(subject));
  const landed: Landed[] = [];
  const appended: Id<"led">[] = [];
  await race(subject, async (writer, index) =>
    inOrder(stepsOf(plan, index), async ({ planned, k }) => {
      const n = 100 + index * 10 + k;
      if (planned.kind === "count") {
        landed.push(await count(writer, planned, n));
      } else {
        appended.push(...(await append(writer, n)));
      }
    }),
  );
  await assertBookedOnce(subject, landed);
  await assertAppendedOnce(subject, appended);
}

/**
 * The property that no interleaving of racing writers counts a landed fill twice, by any of the
 * three writes that count one, or writes a ledger entry twice, whatever conflicts and retries it
 * meets: `runs` plans, each on a fresh database from `harness`. fast-check picks each writer's
 * steps and the scheduler their interleaving, so interleavings are sampled, not searched, and a
 * plan run again may interleave otherwise: a failure stops at once, unshrunk, and its report
 * names the seed and the failing plan.
 */
export function noDoubleBookingProperty(harness: MoneyRaceHarness, runs: number): ContractCheck {
  return {
    name: "books no fill or ledger entry twice in any interleaving of the writers",
    run: async () => {
      await fc.assert(
        fc.asyncProperty(plans, async (plan) => runPlan(harness, plan)),
        { numRuns: runs, endOnFailure: true },
      );
    },
  };
}
