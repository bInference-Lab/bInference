import { chainRefSchema } from "@binference/chain";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  oneBnbWei,
  testAddresses,
  testCeilingRequest,
  testChain,
} from "../testing/custody-fixtures.js";
import { buildCeiling } from "./build-ceiling.js";
import type { CeilingRequest } from "./ceiling.js";
import { type PolicyRule, policyRuleJson } from "./policy-rule.js";
import { isBuiltCeiling, readCeiling } from "./read-ceiling.js";

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

// One rule with one condition's value changed.
function ruleWithValue(
  rule: PolicyRule,
  change: { readonly field: string; readonly value: readonly string[] },
): PolicyRule {
  const conditions = rule.conditions.map((condition) =>
    condition.field === change.field ? { ...condition, value: change.value } : condition,
  );
  return { ...rule, conditions };
}

// The test ceiling's rules as Privy holds them, with one condition's value changed in one rule.
function withValue(change: {
  readonly rule: string;
  readonly field: string;
  readonly value: readonly string[];
}): readonly JsonValue[] {
  const ceiling = buildCeiling(testCeilingRequest());
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  return ceiling.value.rules.map((rule) =>
    jsonValueSchema.parse(
      policyRuleJson(rule.name === change.rule ? ruleWithValue(rule, change) : rule),
    ),
  );
}

describe("isBuiltCeiling", () => {
  const { rescue, saved, unsaved, router } = testAddresses;

  it("holds for a ceiling buildCeiling built, on one chain or two, in any rule order", () => {
    const request = testCeilingRequest();
    const other = { ...testChain, ref: chainRefSchema.parse("eip155:204"), chainId: 204 };
    const second = { chain: other, contracts: [router], spenders: [], perTxNativeCapBase: 5n };
    const two = rulesOf({ ...request, chains: [...request.chains, second] });

    expect(isBuiltCeiling(rulesOf(request))).toBe(true);
    expect(isBuiltCeiling(two)).toBe(true);
    expect(isBuiltCeiling(two.toReversed())).toBe(true);
  });

  it("fails token sends that pay an address the native sends do not", () => {
    const change = { rule: "Token sends, chain 56", field: "transfer.to" };

    expect(isBuiltCeiling(withValue({ ...change, value: [rescue, saved, unsaved] }))).toBe(false);
    expect(isBuiltCeiling(withValue({ ...change, value: [rescue] }))).toBe(false);
  });

  it("fails a rule no ceiling holds, a missing rule, or an address in lower case", () => {
    const rules = rulesOf(testCeilingRequest());
    const [calls] = rulesOf(testCeilingRequest());
    const extra = {
      ...z.record(z.string(), jsonValueSchema).parse(calls),
      name: "Approvals, chain 97",
    };
    const lower = withValue({
      rule: "Native sends, chain 56",
      field: "to",
      value: [rescue.toLowerCase(), saved],
    });

    expect(isBuiltCeiling([...rules, extra])).toBe(false);
    expect(isBuiltCeiling(rules.filter((_, index) => index !== 4))).toBe(false);
    expect(isBuiltCeiling(lower)).toBe(false);
    expect(isBuiltCeiling([...rules, { name: 7 }])).toBe(false);
  });

  it("fails a ceiling that names no chain or no recipient", () => {
    const rules = rulesOf(testCeilingRequest());

    expect(isBuiltCeiling(rules.slice(-2))).toBe(false);
    expect(
      isBuiltCeiling(withValue({ rule: "Native sends, chain 56", field: "to", value: [] })),
    ).toBe(false);
  });
});
