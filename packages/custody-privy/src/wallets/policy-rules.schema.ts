import { type JsonValue, stableJson } from "@binference/core";
import { z } from "zod";

// What decides a rule's effect, and nothing else: Privy's ids, its echoed defaults and any field
// it adds later are left out. An ABI counts by its function names and named, typed inputs, since
// Privy decodes calldata and names fields with them.
const parameter = z.object({ name: z.string().default(""), type: z.string() });

const abiItem = z.object({
  type: z.string(),
  name: z.string().default(""),
  inputs: z.array(parameter).default([]),
});

const condition = z.object({
  field_source: z.string(),
  field: z.string(),
  operator: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  abi: z.array(abiItem).optional(),
});

const rule = z.object({
  name: z.string(),
  method: z.string(),
  action: z.string(),
  conditions: z.array(condition),
});

type Condition = z.infer<typeof condition>;

function abiText(abi: Condition["abi"]): JsonValue {
  return (abi ?? []).map((item) => {
    const inputs = item.inputs.map((input) => `${input.type} ${input.name}`).join(",");
    return `${item.type} ${item.name}(${inputs})`;
  });
}

// `in` reads its values as a set, so their order does not count.
function conditionJson(item: Condition): JsonValue {
  const value =
    typeof item.value === "string" || item.operator !== "in" ? item.value : item.value.toSorted();
  return {
    field_source: item.field_source,
    field: item.field,
    operator: item.operator,
    value,
    abi: abiText(item.abi),
  };
}

/**
 * Each rule as canonical text of what decides its effect, sorted, since Privy applies rules, and
 * the conditions of a rule, in no order. Two policies whose texts are equal allow and deny the
 * same requests. A rule this cannot read makes the whole list undefined.
 */
export function ruleTexts(rules: readonly JsonValue[]): readonly string[] | undefined {
  const texts: string[] = [];
  for (const item of rules) {
    const parsed = rule.safeParse(item);
    if (!parsed.success) {
      return undefined;
    }
    const { name, method, action, conditions } = parsed.data;
    const all = conditions.map((each) => stableJson(conditionJson(each))).toSorted();
    texts.push(stableJson({ name, method, action, conditions: all }));
  }
  return texts.toSorted();
}
