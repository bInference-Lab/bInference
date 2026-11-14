import { isDeepStrictEqual } from "node:util";
import type { SchemaChange } from "./compare-schemas.mjs";

type JsonObject = Readonly<Record<string, unknown>>;

/** A row's scope, and the scope one case of its calls needs in its place. */
interface ScopeRule {
  readonly scope: string;
  readonly scopeCase?: { readonly scope: string; readonly when: string };
}

// The clients that hold each scope (protocol spec, section 4.1): who may make a call that needs it.
const holders: Readonly<Record<string, readonly string[]>> = {
  read: ["cli", "runtime", "mcp", "console", "mini"],
  propose: ["cli", "runtime", "mcp", "console"],
  chat: ["cli", "console", "mini"],
  agent: ["runtime"],
  confirm: ["cli", "console", "mini"],
  loosen: ["cli", "console", "mini"],
  admin: ["cli", "console"],
};

const scopeKeys = ['"scope" ', '"scopeCase" '];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ruleOf(schema: unknown): ScopeRule | undefined {
  if (!isObject(schema) || typeof schema["scope"] !== "string") {
    return undefined;
  }
  const scopeCase = schema["scopeCase"];
  if (!isObject(scopeCase)) {
    return { scope: schema["scope"] };
  }
  return {
    scope: schema["scope"],
    scopeCase: { scope: String(scopeCase["scope"]), when: String(scopeCase["when"]) },
  };
}

// Who may make the call in the case `when`, or in every other case when `when` is undefined.
function callersOf(rule: ScopeRule, when: string | undefined): ReadonlySet<string> {
  const scope =
    when !== undefined && rule.scopeCase?.when === when ? rule.scopeCase.scope : rule.scope;
  return new Set(holders[scope] ?? []);
}

function isSubset(inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean {
  return [...inner].every((client) => outer.has(client));
}

/** How a row's scope moved: to fewer callers in some case and more in none, to more, or neither. */
type ScopeMove = "narrowed" | "widened" | "other";

function moveOf(before: ScopeRule, after: ScopeRule): ScopeMove {
  const cases = [undefined, before.scopeCase?.when, after.scopeCase?.when];
  const pairs = cases.map((when) => ({
    before: callersOf(before, when),
    after: callersOf(after, when),
  }));
  if (pairs.some((pair) => !isSubset(pair.after, pair.before))) {
    return "widened";
  }
  const isNewCase =
    after.scopeCase !== undefined && !isDeepStrictEqual(after.scopeCase, before.scopeCase);
  const isFewer = pairs.some((pair) => pair.after.size < pair.before.size);
  return isFewer && !isNewCase ? "narrowed" : "other";
}

/** The operation a change is to, from its schema's name `call/<op>`, `reply/<op>` and the like. */
function operationOf(where: string): string | undefined {
  const match = /^(?:call|reply)\/([a-zA-Z]+\/[a-zA-Z]+)(?:\.|$)/.exec(where);
  return match?.[1];
}

function isScopeChange(item: SchemaChange): boolean {
  return (
    /^call\/[a-zA-Z]+\/[a-zA-Z]+$/.test(item.where) &&
    scopeKeys.some((key) => item.what.startsWith(key))
  );
}

/** What the rule on unbuilt rows makes of the changes: each as it stands, and why one is refused. */
export interface ScopeVerdict {
  readonly changes: readonly SchemaChange[];
  /** One line per row the rule refuses, saying why. */
  readonly reasons: readonly string[];
}

/** What a judge of one change reads: the schemas on both sides and the unbuilt rows. */
interface Judging {
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly notBuilt: ReadonlySet<string>;
}

const shapeReason =
  "a row the engine leaves unserved as not built changes only by a narrower scope";
const servedReason = "only a row the engine leaves unserved as not built may narrow its scope";

// A change to a row's scope: narrowed on an unbuilt row, else a break with its reason.
function judgeScope(item: SchemaChange, operation: string, judging: Judging) {
  const before = ruleOf(judging.before[item.where]);
  const after = ruleOf(judging.after[item.where]);
  const move = before === undefined || after === undefined ? "other" : moveOf(before, after);
  if (move === "widened") {
    return { item, reason: `${item.where}: the change widens who may call it` };
  }
  if (move !== "narrowed") {
    return { item };
  }
  if (!judging.notBuilt.has(operation)) {
    return { item, reason: `${item.where}: ${servedReason}` };
  }
  const what = `${item.what}, which narrows a row the engine leaves unserved`;
  return { item: { kind: "narrowed", where: item.where, what } satisfies SchemaChange };
}

// One change: a scope change judged by the rule, any other break to an unbuilt row with its reason.
function judgeOne(
  item: SchemaChange,
  judging: Judging,
): { readonly item: SchemaChange; readonly reason?: string } {
  const operation = operationOf(item.where);
  if (operation === undefined || item.kind === "added") {
    return { item };
  }
  if (isScopeChange(item)) {
    return judgeScope(item, operation, judging);
  }
  const row = item.where.split(".")[0] ?? item.where;
  return judging.notBuilt.has(operation) ? { item, reason: `${row}: ${shapeReason}` } : { item };
}

/**
 * Applies the rule on rows the engine leaves unserved as not built: no client can rely on such a
 * row, so its scope may narrow inside a version, to fewer callers in some case and more in none,
 * and the change becomes `narrowed`. Narrowing a served row, widening any row, and any other change
 * to an unbuilt row's shape stay breaks, each with a reason.
 */
export function judgeScopes(
  changes: readonly SchemaChange[],
  schemas: { readonly before: JsonObject; readonly after: JsonObject },
  notBuilt: ReadonlySet<string>,
): ScopeVerdict {
  const judged = changes.map((item) => judgeOne(item, { ...schemas, notBuilt }));
  const reasons = judged.flatMap(({ reason }) => (reason === undefined ? [] : [reason]));
  return { changes: judged.map(({ item }) => item), reasons: [...new Set(reasons)] };
}
