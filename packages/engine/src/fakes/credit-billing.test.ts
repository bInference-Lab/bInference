import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { modelBillingContract } from "../contracts/model-billing-contract.js";
import { createCreditBilling } from "./credit-billing.js";

const first = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"agt">;
const second = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"agt">;
const stranger = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000003" as Id<"agt">;
const live = { signal: new AbortController().signal };
const charge = (agent: Id<"agt">, usdMicros: bigint) => ({ agent, model: "m", usdMicros, atMs: 0 });

describe("credit billing", () => {
  it.each(
    modelBillingContract({
      create: async (allowances) =>
        createCreditBilling(
          [...allowances].map(([agent, credit]: readonly [Id<"agt">, bigint]) => ({
            credit,
            agents: [agent],
          })),
        ),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("spends one owner's credit for every agent it pays for", async () => {
    const billing = createCreditBilling([{ credit: 5_000_000n, agents: [first, second] }]);
    await billing.charge(charge(first, 2_000_000n), live);
    await expect(billing.charge(charge(second, 1_000_000n), live)).resolves.toBe(2_000_000n);
    await expect(billing.left(first, live)).resolves.toBe(2_000_000n);
  });

  it("gives an agent no account pays for nothing to spend, and charges no one for it", async () => {
    const billing = createCreditBilling([{ credit: 5_000_000n, agents: [first] }]);
    await expect(billing.charge(charge(stranger, 1_000_000n), live)).resolves.toBe(0n);
    await expect(billing.left(stranger, live)).resolves.toBe(0n);
    await expect(billing.left(first, live)).resolves.toBe(5_000_000n);
  });
});
