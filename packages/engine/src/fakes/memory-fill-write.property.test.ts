import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intentDraft, intentMove } from "../contracts/intent-fixtures.js";
import { activeOrder, fillRow } from "../contracts/order-fill-checks.js";
import { orderMove } from "../contracts/order-fixtures.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import type { OrderMove } from "../orders/order-record.js";
import { subjectOf } from "./test-order-subject.js";

/** One fill write: its own order's move, if any, and whether it also ends another order. */
interface Case {
  readonly own?: { readonly state: "active" | "filled"; readonly fills: number };
  readonly endsOther: boolean;
}

const cases: fc.Arbitrary<Case> = fc.record(
  {
    own: fc.record({
      state: fc.constantFrom("active" as const, "filled" as const),
      fills: fc.integer({ min: 0, max: 3 }),
    }),
    endsOther: fc.boolean(),
  },
  { requiredKeys: ["endsOther"] },
);

function movesOf(item: Case): readonly OrderMove[] {
  const own =
    item.own === undefined ? [] : [{ ...orderMove(1, 1, item.own.state), fills: item.own.fills }];
  const ended = { ...orderMove(2, 1, "ended"), endReason: "position_closed" as const };
  return [...own, ...(item.endsOther ? [ended] : [])];
}

describe("a fill's write on its order, for every set of order moves", () => {
  it("commits only with its order's own move to one fill more, and else writes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        const subject = await subjectOf();
        await activeOrder(subject, 1);
        await activeOrder(subject, 2);
        await subject.intents.create(intentDraft(subject, 3), live());
        const fill = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
        const move = { ...intentMove(3, 0, "checked"), order: { moves: movesOf(item), fill } };
        const isOwn = item.own?.fills === 1;
        const written = await subject.intents.transition(move, live()).then(
          (result) => result.ok,
          () => false,
        );
        const rows = await subject.store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live());
        expect(written).toBe(isOwn);
        const stored = await subject.store.get(fixtureId("ord", 1), live());
        expect([rows.length > 0, stored?.fills === 1]).toStrictEqual([isOwn, isOwn]);
      }),
      { numRuns: 60 },
    );
  });
});
