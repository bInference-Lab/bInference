import { randomContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createSystemRandom } from "./system-random.js";

describe("the system random source", () => {
  it.each(randomContract({ create: () => createSystemRandom() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
