import type { JsonValue } from "@binference/core";
import { z } from "zod";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { CallRuleLists } from "./call-lists.js";
import type { DayCap } from "./ceiling.js";

/** One condition of a rule Privy holds, as far as the ceiling reads it. */
interface HeldCondition {
  readonly fieldSource: string;
  readonly field: string;
  readonly operator: string;
  readonly value: string | readonly string[];
  /** The condition's ABI as Privy echoes it; only calldata conditions carry one. */
  readonly abi: readonly JsonValue[];
}

/** A rule Privy holds: its name and its conditions. */
export interface HeldRule {
  readonly name: string;
  readonly conditions: readonly HeldCondition[];
}

// The fields of a rule this reads; Privy's ids and anything it adds later are left out.
const ruleSchema: z.ZodType<HeldRule> = z
  .object({
    name: z.string(),
    conditions: z.array(
      z.object({
        field_source: z.string(),
        field: z.string(),
        operator: z.string(),
        value: z.union([z.string(), z.array(z.string())]),
        abi: z.array(z.json()).default([]),
      }),
    ),
  })
  .transform((rule) => ({
    name: rule.name,
    conditions: rule.conditions.map((item) => ({
      fieldSource: item.field_source,
      field: item.field,
      operator: item.operator,
      value: item.value,
      abi: item.abi,
    })),
  }));

/** Each rule as the ceiling reads it, or undefined when one cannot be read. */
export function heldRules(rules: readonly JsonValue[]): readonly HeldRule[] | undefined {
  const read = rules.map((rule) => ruleSchema.safeParse(rule));
  return read.every((item) => item.success) ? read.map((item) => item.data) : undefined;
}

/** The values of a rule's condition on a field with an operator; none when it has no such one. */
export function valuesOf(rule: HeldRule, field: string, operator: string): readonly string[] {
  const found = rule.conditions.find((item) => item.field === field && item.operator === operator);
  if (found === undefined) {
    return [];
  }
  return typeof found.value === "string" ? [found.value] : found.value;
}

const quantity = /^0x[0-9a-fA-F]{1,64}$/;
const aggregationField = /^aggregation\.(.+)$/;
const walletAddress = "{{wallet.address}}";

/** A hex quantity as a number; anything else is undefined. */
export function quantityOf(text: string | undefined): bigint | undefined {
  return text !== undefined && quantity.test(text) ? BigInt(text) : undefined;
}

/** The caps a rule's reference conditions name, in order; undefined if one is malformed. */
export function capsIn(rule: HeldRule): readonly DayCap[] | undefined {
  const caps: DayCap[] = [];
  for (const condition of rule.conditions.filter((item) => item.fieldSource === "reference")) {
    const aggregation = aggregationField.exec(condition.field)?.[1];
    const limitBase = typeof condition.value === "string" ? quantityOf(condition.value) : undefined;
    if (aggregation === undefined || limitBase === undefined || condition.operator !== "lte") {
      return undefined;
    }
    caps.push({ aggregation, limitBase });
  }
  return caps;
}

/**
 * The function a call rule allows and the inputs it pins to the signing wallet, read from its
 * `function_name` condition and its pins; its contracts as the rule lists them. Undefined when it
 * names no function, or names it otherwise than its ABI.
 */
export function callIn(rule: HeldRule): CallRuleLists | undefined {
  const named = rule.conditions.find((item) => item.field === "function_name");
  const abi = abiFunctionSchema.safeParse(named?.abi[0]);
  if (named === undefined || !abi.success || named.value !== abi.data.name) {
    return undefined;
  }
  const prefix = `${abi.data.name}.`;
  const walletInputs = rule.conditions
    .filter((item) => item.field.startsWith(prefix) && item.value === walletAddress)
    .map((item) => item.field.slice(prefix.length));
  return { abi: abi.data, walletInputs, contracts: valuesOf(rule, "to", "in") };
}
