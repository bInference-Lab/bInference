import { isJsonSchemaNode, type JsonSchemaNode, type JsonValue } from "@binference/core";
import {
  type ArgumentObject,
  type ArgumentValue,
  isArgumentObject,
  numberOf,
} from "./read-arguments.js";
import type { RepairStep } from "./repair-step.js";

/** Arguments after the value steps, and the steps that changed them. */
export interface ValueRepair {
  readonly value: ArgumentObject;
  readonly steps: readonly RepairStep[];
}

const unions = ["anyOf", "oneOf", "allOf"] as const;
const plainDigits = /^(?:0|[1-9]\d*)$/u;

function isUnionFree(node: JsonSchemaNode): boolean {
  return unions.every((keyword) => node[keyword] === undefined);
}

// An object's schema the value steps may read: an object's, its fields named, under no union.
function objectFields(node: JsonValue | undefined): JsonSchemaNode | undefined {
  if (node === undefined || !isJsonSchemaNode(node) || node["type"] !== "object") {
    return undefined;
  }
  const properties = node["properties"];
  return isUnionFree(node) && properties !== undefined && isJsonSchemaNode(properties)
    ? properties
    : undefined;
}

function isList<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

function requiredOf(node: JsonSchemaNode): readonly JsonValue[] {
  const required = node["required"];
  return required !== undefined && isList(required) ? required : [];
}

// A field's schema of one type that is not null, under no union, and with no null among its values.
function takesNoNull(field: JsonSchemaNode): boolean {
  const values = field["enum"];
  return (
    typeof field["type"] === "string" &&
    field["type"] !== "null" &&
    isUnionFree(field) &&
    !(values !== undefined && isList(values) && values.includes(null))
  );
}

function isInteger(field: JsonSchemaNode): boolean {
  return field["type"] === "integer" && isUnionFree(field);
}

/** Where the walk writes the steps it took. */
interface Steps {
  readonly taken: Set<RepairStep>;
}

function fieldValue(item: ArgumentValue, field: JsonSchemaNode, steps: Steps): ArgumentValue {
  if (
    typeof item === "string" &&
    isInteger(field) &&
    plainDigits.test(item) &&
    Number.isSafeInteger(Number(item))
  ) {
    steps.taken.add("integer_string");
    return numberOf(item);
  }
  if (isArgumentObject(item)) {
    return objectValue(item, field, steps);
  }
  const items = field["items"];
  return isList<ArgumentValue>(item) && items !== undefined && isJsonSchemaNode(items)
    ? item.map((each) => (isArgumentObject(each) ? objectValue(each, items, steps) : each))
    : item;
}

function objectValue(value: ArgumentObject, schema: JsonSchemaNode, steps: Steps): ArgumentObject {
  const fields = objectFields(schema);
  if (fields === undefined) {
    return value;
  }
  const required = requiredOf(schema);
  const kept: [string, ArgumentValue][] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = fields[key];
    const fieldNode = field !== undefined && isJsonSchemaNode(field) ? field : undefined;
    if (fieldNode === undefined) {
      kept.push([key, item]);
    } else if (item === null && !required.includes(key) && takesNoNull(fieldNode)) {
      steps.taken.add("null_optional");
    } else {
      kept.push([key, fieldValue(item, fieldNode, steps)]);
    }
  }
  return Object.fromEntries(kept);
}

/**
 * The value steps of a repair (runtime spec, section 5.6), for a read or a machine call: in each
 * object the tool's JSON Schema names under no union, a string of plain digits where a field asks
 * for an integer below 2^53 becomes that integer (`integer_string`), and `null` for a field the
 * schema does not require and that takes no `null` leaves the field out (`null_optional`). No
 * other value changes, and no string's content.
 */
export function repairValues(value: ArgumentObject, schema: JsonSchemaNode): ValueRepair {
  const steps: Steps = { taken: new Set() };
  const repaired = objectValue(value, schema, steps);
  return { value: repaired, steps: [...steps.taken] };
}
