import { describe, expect, it } from "vitest";
import { launchDraftAnswersContract } from "../contracts/launch-draft-answers-contract.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createFakeLaunchDraftAnswers } from "./fake-launch-draft-answers.js";

const ref = "AAAAAAAAAAAAAAAA";

describe("fake launch draft answers", () => {
  it.each(
    launchDraftAnswersContract({
      create: async () => {
        const answers = createFakeLaunchDraftAnswers({ ownerId });
        answers.open(ref);
        return Promise.resolve({
          answers,
          ref,
          ownerId,
          started: async () => Promise.resolve(answers.started().length),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers a Start with the standing the test gives", async () => {
    const answers = createFakeLaunchDraftAnswers({ ownerId });
    answers.open(ref, { status: "failed", error: "intent.launch_waiting" });
    const live = { signal: new AbortController().signal };
    expect(await answers.answer({ ref, start: true, presserId: ownerId }, live)).toStrictEqual({
      status: "failed",
      error: "intent.launch_waiting",
    });
  });
});
