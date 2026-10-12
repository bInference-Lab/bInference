import { describe, expect, it } from "vitest";
import { toolBoxContract } from "../contracts/tool-box-contract.js";
import { testToolBox } from "./test-turns.js";

describe("testToolBox", () => {
  it.each(
    toolBoxContract({
      create: async () => ({
        box: testToolBox([
          { name: "quote", kind: "read", parallel: true },
          { name: "swap", kind: "propose" },
        ]),
        call: { id: "c1", name: "swap", argumentsText: '{"amount":"1"}' },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
