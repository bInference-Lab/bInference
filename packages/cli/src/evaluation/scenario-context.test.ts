import { idSchema } from "@binference/core";
import { contextSourceContract } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { scenarioContextOf } from "./scenario-context.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const unknownAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const rules = "# Rules\nNever buy a token with a tax above 10%.\n";
const bnb = {
  key: "BNB",
  asset: "eip155:56/slip44:714",
  symbol: "BNB",
  name: "BNB",
  decimals: 18,
  verified: true,
  priceUsdMicros: "600000000",
};
const skill = {
  name: "safe-swap",
  description: "Swaps a token the safe way.",
  location: "bundled/safe-swap/SKILL.md",
};
const facts = {
  tokens: [bnb],
  balances: [{ token: "BNB", base: "1000000000000000000" }],
  skills: [{ ...skill, text: "---\nname: safe-swap\n---\n# Safe swap\n" }],
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  now: 1_767_261_600_000,
};

describe("scenarioContextOf", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const source = scenarioContextOf({ workspace: { "RULES.md": rules } }, facts, agent);
        return Promise.resolve({ source, agent, unknownAgent, rules, skills: [skill] });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
