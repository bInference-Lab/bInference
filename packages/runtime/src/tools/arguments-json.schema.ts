import {
  BinferenceError,
  err,
  type JsonValue,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import { jsonShapeProblem } from "./json-shape.schema.js";

/** The longest arguments text a call may have: far above what 4,096 output tokens can write. */
export const maxArgumentsChars = 65_536;

/** The deepest nesting of objects and arrays a call's arguments may have. */
export const maxArgumentsDepth = 64;

/** Why a call's arguments are refused. */
export type ArgumentsProblem =
  | "not_json"
  | "too_large"
  | "too_deep"
  | "duplicate_key"
  | "unsafe_number";

/** What the parser's reviver sees of a value's own text (ECMAScript's JSON.parse source text). */
interface SourceText {
  readonly source?: string;
}

const integerLiteral = /^-?(?:0|[1-9]\d*)$/;

// The reviver's way out: a number the parse would round.
const unsafeNumber = new BinferenceError({
  code: "runtime.unsafe_number",
  message: "An integer past 2^53 is not written as plain digits.",
});

// JSON.parse turns an integer past 2^53 into the nearest double, which is another amount. Written
// as plain digits, the reviver gives it back as those digits, which a decimal string schema reads;
// written any other way (`1e21`, `9007199254740993.0`), it is refused rather than rounded.
// Fractions below 2^53 stay numbers.
function keepExactIntegers(key: string, value: unknown, text?: SourceText): unknown {
  if (typeof value !== "number" || Number.isSafeInteger(value) || !Number.isInteger(value)) {
    return value;
  }
  const source = text?.source;
  if (source !== undefined && integerLiteral.test(source)) {
    return source;
  }
  throw unsafeNumber;
}

function parsed(text: string): Result<JsonValue, ArgumentsProblem> {
  try {
    const checked = jsonValueSchema.safeParse(JSON.parse(text, keepExactIntegers));
    return checked.success ? ok(checked.data) : err("not_json");
  } catch (error) {
    return err(error === unsafeNumber ? "unsafe_number" : "not_json");
  }
}

/**
 * Parses a tool call's arguments (runtime spec, section 5.2). An integer past 2^53 written as
 * plain digits becomes a string of those exact digits; one written any other way is
 * `unsafe_number`, never rounded. Text over {@link maxArgumentsChars}, nesting past
 * {@link maxArgumentsDepth} and a key written twice in one object are refused before the parse.
 * Empty text is an empty object, as models send for a tool with no arguments. Nothing here throws.
 */
export function parseArgumentsJson(text: string): Result<JsonValue, ArgumentsProblem> {
  if (text.length > maxArgumentsChars) {
    return err("too_large");
  }
  if (text.trim() === "") {
    return ok({});
  }
  const problem = jsonShapeProblem(text, maxArgumentsDepth);
  return problem === undefined ? parsed(text) : err(problem);
}
