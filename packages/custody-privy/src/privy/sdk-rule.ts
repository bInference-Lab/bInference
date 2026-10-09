import type { PolicyRuleRequestBody } from "@privy-io/node/resources";
import type { PolicyCondition, PolicyRule } from "../ceiling/policy-rule.js";

function valueOf(condition: PolicyCondition): string | string[] {
  return typeof condition.value === "string" ? condition.value : [...condition.value];
}

// The SDK's request types take mutable arrays; the ceiling's stay readonly.
function sdkCondition(condition: PolicyCondition) {
  return condition.field_source === "ethereum_calldata"
    ? {
        field_source: condition.field_source,
        field: condition.field,
        abi: condition.abi,
        operator: condition.operator,
        value: valueOf(condition),
      }
    : {
        field_source: condition.field_source,
        field: condition.field,
        operator: condition.operator,
        value: valueOf(condition),
      };
}

/** A rule as the SDK's request types take it. */
export function sdkRule(rule: PolicyRule): PolicyRuleRequestBody {
  const { name, method, action } = rule;
  return { name, method, action, conditions: rule.conditions.map(sdkCondition) };
}
