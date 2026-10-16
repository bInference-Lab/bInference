import { chainRefSchema } from "@binference/chain";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  oneBnbWei,
  testAddresses,
  testCalls,
  testCaps,
  testCeilingRequest,
  testChain,
  testLaunch,
  testLaunchCeilingRequest,
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

// The test request's one chain.
const testChainLists = {
  chain: testChain,
  calls: testCalls,
  spenders: [testAddresses.router],
  perTxNativeCapBase: oneBnbWei,
  caps: testCaps,
};

function builtRules(): readonly PolicyRule[] {
  const ceiling = buildCeiling(testCeilingRequest());
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  return ceiling.value.rules;
}

// The rule named, without its 24-hour cap; any other rule as it is.
function withoutCap(rule: PolicyRule, name: string): PolicyRule {
  const conditions = rule.conditions.filter((item) => item.field_source !== "reference");
  return rule.name === name ? { ...rule, conditions } : rule;
}

describe("readCeiling", () => {
  it("reads back the chains, contracts, caps and recipients a ceiling was built with", () => {
    expect(readCeiling(rulesOf(testCeilingRequest()))).toStrictEqual({
      chainIds: ["56"],
      contracts: [testAddresses.router],
      perTxNativeCapBase: oneBnbWei,
      recipients: [testAddresses.rescue, testAddresses.saved],
      caps: [{ chainId: "56", caps: testCaps }],
      isLaunch: false,
      launchCalls: [],
    });
  });

  it("reads a launch wallet's ceiling as one, its cap and caps from its launch rules alone", () => {
    const launchOnly = {
      ...testLaunchCeilingRequest(),
      chains: [{ ...testChainLists, calls: [], spenders: [], launch: testLaunch }],
    };
    expect(readCeiling(rulesOf(launchOnly))).toStrictEqual({
      chainIds: ["56"],
      contracts: [],
      perTxNativeCapBase: oneBnbWei,
      recipients: [testAddresses.rescue, testAddresses.saved],
      caps: [{ chainId: "56", caps: testCaps }],
      isLaunch: true,
      launchCalls: ["buy", "sell", "approve"],
    });
    expect(readCeiling(rulesOf(testLaunchCeilingRequest()))).toMatchObject({
      contracts: [testAddresses.router],
      isLaunch: true,
      launchCalls: ["buy", "sell", "approve"],
    });
  });

  it("reads a cap of nothing, and no 24-hour caps, from a ceiling that allows no call", () => {
    const chain = { ...testChainLists, calls: [] };
    const request = { ...testCeilingRequest(), chains: [chain] };

    expect(readCeiling(rulesOf(request))).toMatchObject({
      contracts: [],
      perTxNativeCapBase: 0n,
      caps: [],
    });
  });

  it("reads nothing from a rule it cannot read or a cap that is no quantity", () => {
    const rules = rulesOf(testCeilingRequest());
    const badCap = {
      name: "Call swap, chain 56",
      conditions: [
        { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "one bnb" },
      ],
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
    condition.field_source !== "reference" && condition.field === change.field
      ? { ...condition, value: change.value }
      : condition,
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

// A rule as JSON, as far as the launch tests change it.
const ruleJson = z.looseObject({
  name: z.string(),
  conditions: z.array(z.looseObject({ field: z.string() })),
});

type RuleJson = z.infer<typeof ruleJson>;

// The rules with each one changed as given.
function changed(rules: readonly JsonValue[], change: (rule: RuleJson) => RuleJson) {
  return rules.map((json) => jsonValueSchema.parse(change(ruleJson.parse(json))));
}

// The launch buy rule named for another chain; any other rule as it is.
function movedToChain97(rule: RuleJson): RuleJson {
  return rule.name === "Launch call buy, chain 56"
    ? { ...rule, name: "Launch call buy, chain 97" }
    : rule;
}

// The launch sale paying the rescue address instead of the wallet itself.
function payingRescue(rule: RuleJson): RuleJson {
  const pinned = (condition: RuleJson["conditions"][number]) =>
    condition.field === "sell.recipient"
      ? Object.assign({}, condition, { value: testAddresses.rescue })
      : condition;
  return { ...rule, conditions: rule.conditions.map(pinned) };
}

// The launch buy without the pin of its recipient.
function pinless(rule: RuleJson): RuleJson {
  const kept = rule.conditions.filter((condition) => condition.field !== "buy.recipient");
  return { ...rule, conditions: kept };
}

describe("isBuiltCeiling", () => {
  const { rescue, saved, unsaved } = testAddresses;

  it("holds for a ceiling buildCeiling built, on one chain or two, in any rule order", () => {
    const request = testCeilingRequest();
    const other = { ...testChain, ref: chainRefSchema.parse("eip155:204"), chainId: 204 };
    const caps = { native: { aggregation: "othernative", limitBase: 5n }, approvals: [] };
    const second = { ...testChainLists, chain: other, perTxNativeCapBase: 5n, caps };
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
    expect(isBuiltCeiling(rules.filter((_, index) => index !== 5))).toBe(false);
    expect(isBuiltCeiling(lower)).toBe(false);
    expect(isBuiltCeiling([...rules, { name: 7 }])).toBe(false);
  });

  it("fails a call rule without its 24-hour cap, or with a pin or a function it does not build", () => {
    const uncapped = builtRules().map((rule) =>
      jsonValueSchema.parse(policyRuleJson(withoutCap(rule, "Call swap, chain 56"))),
    );
    const unpinned = withValue({
      rule: "Call swapTo, chain 56",
      field: "swapTo.receiver",
      value: [rescue],
    });
    const renamed = withValue({
      rule: "Call swap, chain 56",
      field: "function_name",
      value: ["swapTo"],
    });

    expect(isBuiltCeiling(uncapped)).toBe(false);
    expect(isBuiltCeiling(unpinned)).toBe(false);
    expect(isBuiltCeiling(renamed)).toBe(false);
  });

  it("holds for a launch wallet's ceiling, and fails a launch rule it does not build", () => {
    const launch = rulesOf(testLaunchCeilingRequest());

    expect(isBuiltCeiling(launch)).toBe(true);
    expect(isBuiltCeiling(launch.toReversed())).toBe(true);
    expect(isBuiltCeiling(changed(launch, movedToChain97))).toBe(false);
    expect(isBuiltCeiling(changed(launch, payingRescue))).toBe(false);
    expect(isBuiltCeiling(changed(launch, pinless))).toBe(false);
  });

  it("fails a ceiling that names no chain or no recipient", () => {
    const rules = rulesOf(testCeilingRequest());

    expect(isBuiltCeiling(rules.slice(-2))).toBe(false);
    expect(
      isBuiltCeiling(withValue({ rule: "Native sends, chain 56", field: "to", value: [] })),
    ).toBe(false);
  });
});
