import type { SQLInputValue } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import type { CompiledQuery } from "kysely";

type CompiledParameter = CompiledQuery["parameters"][number];

function isSqlInput(value: CompiledParameter): value is SQLInputValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    ArrayBuffer.isView(value)
  );
}

/**
 * Checks that every value a compiled query binds is one SQLite stores: text, a number, a bigint,
 * bytes or null. Booleans and objects are refused: the schema stores them as integers and JSON.
 */
export function sqlParameters(values: CompiledQuery["parameters"]): SQLInputValue[] {
  return values.map((value, index) => {
    if (!isSqlInput(value)) {
      throw new BinferenceError({
        code: "store.bad_parameter",
        message: `Query parameter ${String(index)} is a ${typeof value}, which SQLite cannot bind; store booleans as 0 or 1 and objects as JSON text.`,
        details: { index, type: typeof value },
      });
    }
    return value;
  });
}
