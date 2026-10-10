import { jsonValueSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  oneBnbWei,
  testAddresses,
  testCeilingRequest,
  testChain,
} from "../testing/custody-fixtures.js";
import { buildCeiling } from "./build-ceiling.js";
import type { CeilingRequest } from "./ceiling.js";
import { policyRuleJson } from "./policy-rule.js";
import { readCeiling } from "./read-ceiling.js";

// The rules of a ceiling as Privy holds them: JSON, as its API answers them.
function rulesOf(request: CeilingRequest) {
  const ceiling = buildCeiling(request);
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  return ceiling.value.rules.map((rule) => jsonValueSchema.parse(policyRuleJson(rule)));
}

describe("readCeiling", () => {
  it("reads back the chains, contracts, cap and recipients a ceiling was built with", () => {
    expect(readCeiling(rulesOf(testCeilingRequest()))).toStrictEqual({
      chainIds: ["56"],
      contracts: [testAddresses.router, testAddresses.permit2],
      perTxNativeCapBase: oneBnbWei,
      recipients: [testAddresses.rescue, testAddresses.saved],
    });
  });

  it("reads a cap of nothing from a ceiling that allows no contract call", () => {
    const chain = { chain: testChain, contracts: [], spenders: [], perTxNativeCapBase: oneBnbWei };
    const request = { ...testCeilingRequest(), chains: [chain] };

    expect(readCeiling(rulesOf(request))).toMatchObject({ contracts: [], perTxNativeCapBase: 0n });
  });

  it("reads nothing from a rule it cannot read or a cap that is no quantity", () => {
    const rules = rulesOf(testCeilingRequest());
    const badCap = {
      name: "Contract calls, chain 56",
      conditions: [{ field: "value", operator: "lte", value: "one bnb" }],
    };

    expect(readCeiling([...rules, { name: 7 }])).toBeUndefined();
    expect(readCeiling([badCap, ...rules])).toBeUndefined();
  });
});
