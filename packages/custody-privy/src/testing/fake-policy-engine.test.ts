import { describe, expect, it } from "vitest";
import { approveData, testAddresses } from "./custody-fixtures.js";
import { evaluatePolicy, type PolicyInput } from "./fake-policy-engine.js";
import type { FakeCondition, FakeRule } from "./fake-privy-request.schema.js";

const { router, rescue, unsaved } = testAddresses;
const wallet = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const input: PolicyInput = {
  method: "eth_signTransaction",
  to: router,
  valueWei: 10n,
  chainId: 56n,
  data: "0x",
  walletAddress: wallet,
};

function on(
  field: string,
  operator: FakeCondition["operator"],
  value: FakeCondition["value"],
): FakeCondition {
  return { field_source: "ethereum_transaction", field, operator, value };
}

function rule(
  action: FakeRule["action"],
  conditions: readonly FakeCondition[],
  method = "eth_signTransaction",
): FakeRule {
  return { name: "rule", method, action, conditions };
}

const approveSpender: FakeCondition = {
  field_source: "ethereum_calldata",
  field: "approve.spender",
  abi: [
    {
      type: "function",
      name: "approve",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ],
  operator: "eq",
  value: rescue,
};

describe("the fake's policy engine", () => {
  it("denies a request no rule allows, and one with no rules at all", () => {
    expect(evaluatePolicy([rule("ALLOW", [on("to", "eq", unsaved)])], input)).toBe("DENY");
    expect(evaluatePolicy([], input)).toBe("DENY");
  });

  it("lets a DENY that applies win over an ALLOW that applies", () => {
    const rules = [
      rule("ALLOW", [on("to", "eq", router)]),
      rule("DENY", [on("chain_id", "eq", "56")]),
    ];
    expect(evaluatePolicy(rules, input)).toBe("DENY");
    expect(evaluatePolicy(rules.slice(0, 1), input)).toBe("ALLOW");
  });

  it("applies only the rules of the request's method, and `*` to every method", () => {
    expect(evaluatePolicy([rule("ALLOW", [], "personal_sign")], input)).toBe("DENY");
    expect(evaluatePolicy([rule("ALLOW", [], "*")], input)).toBe("ALLOW");
  });

  it("applies a rule only when every condition holds", () => {
    const rules = [rule("ALLOW", [on("to", "eq", router), on("value", "lte", "0x5")])];
    expect(evaluatePolicy(rules, input)).toBe("DENY");
    expect(evaluatePolicy(rules, { ...input, valueWei: 5n })).toBe("ALLOW");
  });

  it("compares EVM addresses in any case, as Privy does, and other strings exactly", () => {
    const rules = [rule("ALLOW", [on("to", "in", [router])])];
    expect(evaluatePolicy(rules, input)).toBe("ALLOW");
    expect(evaluatePolicy(rules, { ...input, to: router.toLowerCase() })).toBe("ALLOW");
    const lowerRules = [rule("ALLOW", [on("to", "eq", router.toLowerCase())])];
    expect(evaluatePolicy(lowerRules, input)).toBe("ALLOW");
    expect(evaluatePolicy([rule("ALLOW", [on("to", "eq", "Router")])], input)).toBe("DENY");
  });

  it("denies a plain send under a DENY rule on calldata it cannot decode, as Privy does", () => {
    // Seen on a Privy app on 2026-10-07: the rule below denied a plain send, which the ALLOW let.
    const denyFunction: FakeCondition = {
      field_source: "ethereum_calldata",
      field: "function_name",
      abi: [
        {
          type: "function",
          name: "setApprovalForAll",
          inputs: [],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      operator: "eq",
      value: "setApprovalForAll",
    };
    const rules = [rule("ALLOW", [on("to", "eq", router)]), rule("DENY", [denyFunction])];
    expect(evaluatePolicy(rules, input)).toBe("DENY");
    expect(evaluatePolicy([rule("ALLOW", [on("to", "eq", router)])], input)).toBe("ALLOW");
  });

  it("compares values and chain ids as numbers, in hex or decimal", () => {
    const checks: readonly (readonly [FakeCondition, boolean])[] = [
      [on("value", "lte", "0xa"), true],
      [on("value", "lt", "10"), false],
      [on("value", "gte", "10"), true],
      [on("value", "gt", "0x9"), true],
      [on("value", "eq", "0x0a"), true],
      [on("value", "lte", "ten"), false],
      [on("chain_id", "in", ["1", "56"]), true],
      [on("chain_id", "eq", "0x38"), true],
      [on("chain_id", "eq", "97"), false],
    ];
    for (const [condition, holds] of checks) {
      expect(evaluatePolicy([rule("ALLOW", [condition])], input) === "ALLOW").toBe(holds);
    }
  });

  it("puts the signing wallet's address in place of the wallet address variable", () => {
    const rules = [rule("ALLOW", [on("to", "eq", "{{wallet.address}}")])];
    expect(evaluatePolicy(rules, { ...input, to: wallet })).toBe("ALLOW");
    expect(evaluatePolicy(rules, input)).toBe("DENY");
  });

  it("reads calldata with the condition's ABI, and calldata of another shape meets no condition", () => {
    const rules = [rule("ALLOW", [approveSpender])];
    expect(evaluatePolicy(rules, { ...input, data: approveData(rescue, 1n) })).toBe("ALLOW");
    expect(evaluatePolicy(rules, { ...input, data: approveData(unsaved, 1n) })).toBe("DENY");
    expect(evaluatePolicy(rules, { ...input, data: "0x095ea7b3" })).toBe("DENY");
    expect(evaluatePolicy(rules, input)).toBe("DENY");
  });

  it("never meets a condition on a condition set or an unknown field", () => {
    expect(evaluatePolicy([rule("ALLOW", [on("to", "in_condition_set", "set")])], input)).toBe(
      "DENY",
    );
    expect(evaluatePolicy([rule("ALLOW", [on("gas", "lte", "0x1")])], input)).toBe("DENY");
  });
});
