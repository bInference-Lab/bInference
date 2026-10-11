import { err, type JsonValue, jsonValueSchema, ok, type Result } from "@binference/core";

/** What the parser's reviver sees of a value's own text (ECMAScript's JSON.parse source text). */
interface SourceText {
  readonly source?: string;
}

const integerLiteral = /^-?(?:0|[1-9]\d*)$/;

// JSON.parse turns an integer literal past 2^53 into the nearest double, which is another amount.
// The reviver gives such a literal back as its own digits, which a decimal string schema reads.
function keepExactIntegers(key: string, value: unknown, text?: SourceText): unknown {
  const source = text?.source;
  if (typeof value !== "number" || Number.isSafeInteger(value) || source === undefined) {
    return value;
  }
  return integerLiteral.test(source) ? source : value;
}

/**
 * Parses a tool call's arguments (runtime spec, section 5.2). An integer literal beyond 2^53
 * becomes a string of its exact digits, so an amount the model wrote as a bare number keeps every
 * digit; every other value is what `JSON.parse` gives. Empty text is an empty object, as models
 * send for a tool with no arguments. Text that is not JSON, or holds a number too large for a
 * double, is `not_json`.
 */
export function parseArgumentsJson(text: string): Result<JsonValue, "not_json"> {
  if (text.trim() === "") {
    return ok({});
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, keepExactIntegers);
  } catch {
    return err("not_json");
  }
  const checked = jsonValueSchema.safeParse(parsed);
  return checked.success ? ok(checked.data) : err("not_json");
}
