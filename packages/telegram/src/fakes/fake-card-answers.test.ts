import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { cardAnswersContract } from "../contracts/card-answers-contract.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createFakeCardAnswers } from "./fake-card-answers.js";

const ref = "AAAAAAAAAAAAAAAA";
const live = { signal: new AbortController().signal };

function setUp() {
  const answers = createFakeCardAnswers({ clock: createManualClock(5_000), ownerId });
  answers.open(ref);
  return answers;
}

describe("fake card answers", () => {
  it.each(cardAnswersContract({ create: async () => ({ answers: setUp(), ref, ownerId }) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("leaves the card open once for a refused answer, then closes it", async () => {
    const answers = setUp();
    answers.refuseNext(ref, "no_route");
    const press = { ref, decision: "confirm", presserId: ownerId } as const;
    expect(await answers.answer(press, live)).toStrictEqual({ status: "open", reason: "no_route" });
    expect(await answers.answer(press, live)).toMatchObject({
      status: "closed",
      closing: { outcome: "confirmed", atMs: 5_000 },
    });
    expect(answers.answered()).toStrictEqual([press, press]);
  });

  it("shows a card closed elsewhere as closed, and stores no answer for it", async () => {
    const answers = setUp();
    answers.close(ref, { outcome: "expired", atMs: 4_000 });
    const press = { ref, decision: "confirm", presserId: ownerId } as const;
    expect(await answers.answer(press, live)).toStrictEqual({
      status: "closed",
      closing: { outcome: "expired", atMs: 4_000 },
    });
    expect(answers.answered()).toStrictEqual([]);
  });
});
