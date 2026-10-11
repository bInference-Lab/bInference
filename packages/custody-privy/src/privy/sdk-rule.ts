import type { JsonValue } from "@binference/core";
import type { PolicyRuleRequestBody } from "@privy-io/node/resources";
import type {
  AbiFunction,
  AbiParameter,
  PolicyCondition,
  PolicyRule,
} from "../ceiling/policy-rule.js";

/** An ABI parameter as the SDK's request types take it, its tuple parts as plain objects. */
interface SdkParameter {
  readonly name: string;
  readonly type: string;
  readonly components?: readonly { readonly [key: string]: JsonValue }[];
}

// A tuple's part as the SDK takes it: a plain object, its own parts likewise.
function sdkComponent(parameter: AbiParameter): { readonly [key: string]: JsonValue } {
  const { name, type, components } = parameter;
  return components === undefined
    ? { name, type }
    : { name, type, components: components.map(sdkComponent) };
}

function sdkParameter(parameter: AbiParameter): SdkParameter {
  const { name, type, components } = parameter;
  return components === undefined
    ? { name, type }
    : { name, type, components: components.map(sdkComponent) };
}

function sdkAbi(item: AbiFunction) {
  return {
    type: item.type,
    name: item.name,
    inputs: item.inputs.map(sdkParameter),
    outputs: item.outputs.map(sdkParameter),
    stateMutability: item.stateMutability,
  };
}

function valueOf(condition: PolicyCondition): string | string[] {
  return typeof condition.value === "string" ? condition.value : [...condition.value];
}

// The SDK's request types take mutable arrays; the ceiling's stay readonly.
function sdkCondition(condition: PolicyCondition) {
  const { operator } = condition;
  const value = valueOf(condition);
  if (condition.field_source === "ethereum_calldata") {
    const abi = condition.abi.map(sdkAbi);
    return { field_source: condition.field_source, field: condition.field, abi, operator, value };
  }
  return condition.field_source === "reference"
    ? { field_source: condition.field_source, field: condition.field, operator, value }
    : { field_source: condition.field_source, field: condition.field, operator, value };
}

/** A rule as the SDK's request types take it. */
export function sdkRule(rule: PolicyRule): PolicyRuleRequestBody {
  const { name, method, action } = rule;
  return { name, method, action, conditions: rule.conditions.map(sdkCondition) };
}
