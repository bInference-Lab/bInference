import { describe, expect, it } from "vitest";
import { testAddresses, testCapPlan } from "../testing/custody-fixtures.js";
import { approveAbi } from "./ceiling-abis.js";
import { aggregationsOf, capsOf, dayCapWindowSeconds } from "./day-caps.js";

describe("aggregationsOf", () => {
  it("sums the native coin of every transaction on the chain, and each token's approvals", () => {
    const listed = aggregationsOf(testCapPlan);
    const onChain = {
      field_source: "ethereum_transaction",
      field: "chain_id",
      operator: "eq",
      value: "56",
    };

    expect(listed).toStrictEqual({
      ok: true,
      value: [
        {
          name: "binference native sent, chain 56",
          metric: { field: "value", fieldSource: "ethereum_transaction" },
          windowSeconds: dayCapWindowSeconds,
          conditions: [onChain],
        },
        {
          name: `binference approvals of ${testAddresses.token}, chain 56`,
          metric: { field: "approve.amount", fieldSource: "ethereum_calldata", abi: approveAbi },
          windowSeconds: 86_400,
          conditions: [
            onChain,
            {
              field_source: "ethereum_transaction",
              field: "to",
              operator: "eq",
              value: testAddresses.token,
            },
          ],
        },
      ],
    });
  });

  it("refuses a token that is no EVM address, or one named twice", () => {
    const token = { token: "usdt", limitBase: 1n };
    const twice = { token: testAddresses.token, limitBase: 1n };
    expect(aggregationsOf({ ...testCapPlan, approvals: [token] })).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
    expect(aggregationsOf({ ...testCapPlan, approvals: [twice, twice] })).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
  });
});

describe("capsOf", () => {
  it("pairs the ids Privy gave with the plan's limits, in order, and nothing for another count", () => {
    expect(capsOf(testCapPlan, ["n", "t"])).toStrictEqual({
      native: { aggregation: "n", limitBase: testCapPlan.nativeLimitBase },
      approvals: [{ aggregation: "t", limitBase: 1_000n }],
    });
    expect(capsOf(testCapPlan, ["n"])).toBeUndefined();
  });
});
