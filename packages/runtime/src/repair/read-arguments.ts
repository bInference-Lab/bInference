import { jsonShapeProblem, maxJsonDepth } from "@binference/core";
import { z } from "zod";
import { maxArgumentsChars } from "../tools/arguments-json.schema.js";

/**
 * A number as the model wrote it, digit for digit: `JSON.rawJSON` of its text, which
 * `JSON.stringify` writes back as that text, so a repair never rounds or rewrites a number.
 */
interface RawNumber {
  readonly rawJSON: string;
}

/** A value of a call's arguments as a repair reads them: JSON, each number kept as its text. */
export type ArgumentValue =
  | string
  | boolean
  | null
  | RawNumber
  | readonly ArgumentValue[]
  | ArgumentObject;

/** An object of a call's arguments as a repair reads them. */
export interface ArgumentObject {
  readonly [key: string]: ArgumentValue;
}

// JSON.rawJSON and JSON.isRawJSON (ES2025, in every Node.js binference runs on); ES2023's lib
// does not declare them, so each is read and checked once here.
const rawJson = z
  .custom<(text: string) => RawNumber>((value) => typeof value === "function")
  .parse(Reflect.get(JSON, "rawJSON"));
const isRawJson = z
  .custom<(value: object) => boolean>((value) => typeof value === "function")
  .parse(Reflect.get(JSON, "isRawJSON"));

const rawNumberSchema: z.ZodType<RawNumber> = z.custom<RawNumber>(
  (value) => typeof value === "object" && value !== null && isRawJson(value),
);

const argumentValueSchema: z.ZodType<ArgumentValue> = z.lazy(() =>
  z.union([
    rawNumberSchema,
    z.string(),
    z.boolean(),
    z.null(),
    z.array(argumentValueSchema),
    argumentObjectSchema,
  ]),
);

const argumentObjectSchema: z.ZodType<ArgumentObject> = z.record(z.string(), argumentValueSchema);

/** What the parser's reviver sees of a value's own text (ECMAScript's JSON.parse source text). */
interface SourceText {
  readonly source?: string;
}

function keepNumberText(
  key: string,
  value: string | number | boolean | object | null,
  text?: SourceText,
): string | boolean | object | null {
  if (typeof value !== "number") {
    return value;
  }
  return rawJson(text?.source ?? String(value));
}

/**
 * Reads a call's arguments for a repair: a JSON object within the tool box's size, depth and
 * one-key-once rules, each number kept as written. Answers `undefined` for anything else.
 */
export function readArguments(text: string): ArgumentObject | undefined {
  const written = text.trim() === "" ? "{}" : text;
  if (written.length > maxArgumentsChars || jsonShapeProblem(written, maxJsonDepth) !== undefined) {
    return undefined;
  }
  try {
    const read = argumentObjectSchema.safeParse(JSON.parse(written, keepNumberText));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}

/** A number of the arguments written as `digits`, which `JSON.stringify` writes as they are. */
export function numberOf(digits: string): ArgumentValue {
  return rawJson(digits);
}

/** Whether a value is an object of the arguments, not a list or a number. */
export function isArgumentObject(value: ArgumentValue): value is ArgumentObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isRawJson(value);
}
