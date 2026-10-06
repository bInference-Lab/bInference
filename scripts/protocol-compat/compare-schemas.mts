import { isDeepStrictEqual } from "node:util";

/** How one part of the protocol differs from its snapshot. Inside a version, only `added` passes. */
export interface SchemaChange {
  readonly kind: "added" | "removed" | "changed";
  /** The schema and the path inside it, such as `frame/open.client.kind`. */
  readonly where: string;
  readonly what: string;
}

type JsonObject = Readonly<Record<string, unknown>>;

interface Pair {
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly where: string;
}

// Words for people; a change to them changes no message on the wire.
const ignoredKeys = new Set(["description", "title", "examples", "$comment"]);
// Keywords that hold one schema, compared part by part.
const schemaKeys = new Set(["items", "additionalProperties", "propertyNames", "not", "contains"]);
// Keywords that hold options; an option appended at the end is an addition.
const optionKeys = new Set(["anyOf", "oneOf"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(schema: JsonObject, key: string): JsonObject {
  const value = schema[key];
  return isObject(value) ? value : {};
}

function listAt(schema: JsonObject, key: string): readonly unknown[] {
  const value = schema[key];
  return Array.isArray(value) ? value : [];
}

function requiredOf(schema: JsonObject): ReadonlySet<unknown> {
  return new Set(listAt(schema, "required"));
}

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function change(kind: SchemaChange["kind"], where: string, what: string): SchemaChange {
  return { kind, where, what };
}

function compareLeaf(pair: Pair, key: string): SchemaChange[] {
  const before = pair.before[key];
  const after = pair.after[key];
  return isDeepStrictEqual(before, after)
    ? []
    : [change("changed", pair.where, `"${key}" changes from ${show(before)} to ${show(after)}`)];
}

interface RequiredSets {
  readonly before: ReadonlySet<unknown>;
  readonly after: ReadonlySet<unknown>;
}

function requiredChange(where: string, name: string, required: RequiredSets): SchemaChange[] {
  const isRequired = required.after.has(name);
  if (required.before.has(name) === isRequired) {
    return [];
  }
  const what = isRequired ? "the field became required" : "the field became optional";
  return [change("changed", where, what)];
}

function compareProperties(pair: Pair): SchemaChange[] {
  const before = objectAt(pair.before, "properties");
  const after = objectAt(pair.after, "properties");
  const required = { before: requiredOf(pair.before), after: requiredOf(pair.after) };
  const kept = Object.keys(before).flatMap((name) => {
    const where = `${pair.where}.${name}`;
    if (!(name in after)) {
      return [change("removed", where, "the field was removed")];
    }
    return requiredChange(where, name, required).concat(
      compareSchema(before[name], after[name], where),
    );
  });
  const fresh = Object.keys(after)
    .filter((name) => !(name in before))
    .map((name) =>
      required.after.has(name)
        ? change("changed", `${pair.where}.${name}`, "a new field that is required")
        : change("added", `${pair.where}.${name}`, "a new optional field"),
    );
  return [...kept, ...fresh];
}

function missingFrom(values: readonly unknown[], others: readonly unknown[]): readonly unknown[] {
  return values.filter((value) => !others.some((other) => isDeepStrictEqual(value, other)));
}

function compareEnum(pair: Pair): SchemaChange[] {
  const before = listAt(pair.before, "enum");
  const after = listAt(pair.after, "enum");
  return [
    ...missingFrom(before, after).map((value) =>
      change("removed", pair.where, `the value ${show(value)} was removed`),
    ),
    ...missingFrom(after, before).map((value) =>
      change("added", pair.where, `the value ${show(value)} is new`),
    ),
  ];
}

function compareOptions(pair: Pair, key: string): SchemaChange[] {
  const before = listAt(pair.before, key);
  const after = listAt(pair.after, key);
  return [
    ...before.flatMap((option, index) => {
      const where = `${pair.where}.${key}[${String(index)}]`;
      return index < after.length
        ? compareSchema(option, after[index], where)
        : [change("removed", where, "the option was removed")];
    }),
    ...after
      .slice(before.length)
      .map((_option, offset) =>
        change("added", `${pair.where}.${key}[${String(before.length + offset)}]`, "a new option"),
      ),
  ];
}

function compareKeyword(pair: Pair, key: string): SchemaChange[] {
  if (key === "properties") {
    return compareProperties(pair);
  }
  if (key === "required") {
    return "properties" in pair.before || "properties" in pair.after ? [] : compareLeaf(pair, key);
  }
  if (key === "enum") {
    return compareEnum(pair);
  }
  if (schemaKeys.has(key)) {
    return compareSchema(pair.before[key], pair.after[key], `${pair.where}.${key}`);
  }
  return optionKeys.has(key) ? compareOptions(pair, key) : compareLeaf(pair, key);
}

function compareSchema(before: unknown, after: unknown, where: string): SchemaChange[] {
  if (!isObject(before) || !isObject(after)) {
    return isDeepStrictEqual(before, after)
      ? []
      : [change("changed", where, `changes from ${show(before)} to ${show(after)}`)];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !ignoredKeys.has(key))
    .flatMap((key) => compareKeyword({ before, after, where }, key));
}

/**
 * Compares the protocol's JSON Schemas, by name, against a snapshot of the same version. A new
 * schema, a new optional field, a new enum value and a new option at the end of a union are
 * additions; every other difference is a removal or a change of meaning.
 */
export function compareSchemaSets(before: JsonObject, after: JsonObject): readonly SchemaChange[] {
  return [
    ...Object.keys(before).flatMap((name) =>
      name in after
        ? compareSchema(before[name], after[name], name)
        : [change("removed", name, "the schema was removed")],
    ),
    ...Object.keys(after)
      .filter((name) => !(name in before))
      .map((name) => change("added", name, "a new schema")),
  ];
}
