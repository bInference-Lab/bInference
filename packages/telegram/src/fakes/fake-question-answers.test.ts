import { describe, expect, it } from "vitest";
import { questionAnswersContract } from "../contracts/question-answers-contract.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createFakeQuestionAnswers } from "./fake-question-answers.js";

const ref = "AAAAAAAAAAAAAAAA";
const live = { signal: new AbortController().signal };

function setUp() {
  const answers = createFakeQuestionAnswers({ ownerId });
  answers.open(ref);
  return answers;
}

describe("fake question answers", () => {
  it.each(
    questionAnswersContract({
      create: async () => {
        const answers = setUp();
        return { answers, ref, ownerId, heard: async () => answers.answered().length };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("finds a question closed elsewhere closed, and stores no answer for it", async () => {
    const answers = setUp();
    answers.close(ref);
    const press = { ref, choice: 0, presserId: ownerId };
    expect(await answers.answer(press, live)).toStrictEqual({ status: "closed" });
    expect(answers.answered()).toStrictEqual([]);
  });
});
