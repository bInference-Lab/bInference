import { describe, expect, it } from "vitest";
import { randomContract } from "../contracts/random-contract.js";
import { createSeededRandom } from "./seeded-random.js";

describe("seeded random", () => {
  it.each(randomContract({ create: () => createSeededRandom(42) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("repeats its bytes for the same seed", () => {
    expect(createSeededRandom(9).bytes(16)).toStrictEqual(createSeededRandom(9).bytes(16));
  });
});
