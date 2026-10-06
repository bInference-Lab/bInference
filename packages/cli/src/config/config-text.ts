import JSON5 from "json5";
import type { ConfigProblem } from "./config-issue.js";
import { isJsonObject, type JsonObject, jsonValueSchema } from "./json-value.schema.js";
import { previewOf } from "./validate-config.js";

/** A config file's text read as JSON5: its object, or the problem that stops it. */
export type ConfigText =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly problem: ConfigProblem };

function positionOf(error: Error): { line: number; column: number } {
  const line = "lineNumber" in error && typeof error.lineNumber === "number" ? error.lineNumber : 1;
  const column =
    "columnNumber" in error && typeof error.columnNumber === "number" ? error.columnNumber : 1;
  return { line, column };
}

function parseText(text: string): ConfigText {
  const parsed = jsonValueSchema.safeParse(JSON5.parse(text.replace(/^\uFEFF/, "")));
  if (parsed.success && isJsonObject(parsed.data)) {
    return { ok: true, value: parsed.data };
  }
  const got = parsed.success ? previewOf(parsed.data) : "a number JSON cannot hold";
  return { ok: false, problem: { kind: "bad_value", rule: { kind: "object" }, got } };
}

/**
 * Reads the text of `config.json5`: comments and trailing commas allowed, a byte order mark and
 * Windows line endings accepted. The whole file must be one object. A syntax error names its
 * line and column, never the text around it, which may hold a secret.
 */
export function readConfigText(text: string): ConfigText {
  try {
    return parseText(text);
  } catch (error) {
    const position = error instanceof Error ? positionOf(error) : { line: 1, column: 1 };
    return { ok: false, problem: { kind: "unreadable", ...position } };
  }
}
