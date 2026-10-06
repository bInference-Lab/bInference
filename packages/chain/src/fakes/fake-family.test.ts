import { describe, expect, it } from "vitest";
import { chainFamilyContract } from "../contracts/chain-family-contract.js";
import { createFakeFamily } from "./fake-family.js";

describe("fake family", () => {
  it.each(
    chainFamilyContract({
      create: () => ({
        family: createFakeFamily(),
        addresses: [
          { text: "0x0000000A", canonical: "0x0000000a" },
          { text: "0xabcdef12", canonical: "0xabcdef12" },
        ],
        malformed: ["", "0x123", "0xzzzzzzzz", "0x0000000a0"],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
