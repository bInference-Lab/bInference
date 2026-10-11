import type { JsonValue } from "@binference/core";

/** An operator of Privy's policy conditions that the ceiling uses. */
export type ConditionOperator = "eq" | "in" | "lte";

/** One input or output of an ABI function: its name, its Solidity type and a tuple's parts. */
export interface AbiParameter {
  readonly name: string;
  readonly type: string;
  /** The parts of a `tuple` or `tuple[]`, in order. */
  readonly components?: readonly AbiParameter[];
}

/** One function of a contract ABI, as Privy decodes calldata with it. */
export interface AbiFunction {
  readonly type: "function";
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
  readonly outputs: readonly AbiParameter[];
  readonly stateMutability: "pure" | "view" | "nonpayable" | "payable";
}

/** A condition on the transaction itself: its `to`, its value in wei or its chain id. */
export interface TransactionCondition {
  readonly field_source: "ethereum_transaction";
  readonly field: "to" | "value" | "chain_id";
  readonly operator: ConditionOperator;
  readonly value: string | readonly string[];
}

/**
 * A condition on the calldata, decoded with the ABI: `approve.spender` reads the spender of an
 * `approve` call, `function_name` the function called. Calldata of another function never meets
 * it.
 */
export interface CalldataCondition {
  readonly field_source: "ethereum_calldata";
  readonly field: string;
  readonly abi: readonly AbiFunction[];
  readonly operator: ConditionOperator;
  readonly value: string | readonly string[];
}

/**
 * A condition on one of Privy's aggregations (`aggregation.<id>`): it holds while the sum the
 * aggregation keeps over its window, plus what the request adds, is at most the value. A deleted
 * aggregation makes it fail.
 */
export interface ReferenceCondition {
  readonly field_source: "reference";
  readonly field: string;
  readonly operator: "lte";
  /** The most the sum may reach, in base units, as a hex quantity. */
  readonly value: string;
}

/** A condition of a ceiling rule. Every condition of a rule must hold for the rule to apply. */
export type PolicyCondition = TransactionCondition | CalldataCondition | ReferenceCondition;

/**
 * One rule of a Privy policy, in Privy's own policy language: when every condition holds, the
 * action applies to a request of the method. A `DENY` that applies wins over any `ALLOW`, and a
 * request no rule allows is denied.
 */
export interface PolicyRule {
  /** At most 50 characters, as Privy requires. */
  readonly name: string;
  readonly method: "eth_signTransaction" | "eth_sign7702Authorization" | "exportPrivateKey";
  readonly action: "ALLOW" | "DENY";
  readonly conditions: readonly PolicyCondition[];
}

function parameterJson(parameter: AbiParameter): JsonValue {
  const { name, type, components } = parameter;
  return components === undefined
    ? { name, type }
    : { name, type, components: components.map(parameterJson) };
}

/** A function's ABI entry as the JSON Privy's API takes in a condition's `abi`. */
export function abiFunctionJson(item: AbiFunction): JsonValue {
  return {
    type: item.type,
    name: item.name,
    inputs: item.inputs.map(parameterJson),
    outputs: item.outputs.map(parameterJson),
    stateMutability: item.stateMutability,
  };
}

/** A condition as the JSON Privy's API takes in a rule's or an aggregation's `conditions`. */
export function policyConditionJson(condition: PolicyCondition): JsonValue {
  const value = typeof condition.value === "string" ? condition.value : [...condition.value];
  const { field_source: source, field, operator } = condition;
  return condition.field_source === "ethereum_calldata"
    ? { field_source: source, field, abi: condition.abi.map(abiFunctionJson), operator, value }
    : { field_source: source, field, operator, value };
}

/** A rule as the JSON Privy's API takes in a policy's `rules`. */
export function policyRuleJson(rule: PolicyRule): JsonValue {
  return {
    name: rule.name,
    method: rule.method,
    action: rule.action,
    conditions: rule.conditions.map(policyConditionJson),
  };
}
