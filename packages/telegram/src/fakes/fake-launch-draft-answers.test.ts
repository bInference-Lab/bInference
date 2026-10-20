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
          settled: async () => Promise.resolve(),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
