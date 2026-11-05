import { BinferenceError } from "@binference/core";
import { type CustomTypesConfig, TypeOverrides } from "pg";

// The ids of the server's built-in types, from `pg_type`; they never change.
const typeIds = { int8: 20, int2: 21, int4: 23, numeric: 1700 } as const;

const integerText = /^-?\d+$/;

function parseInteger(text: string): number {
  const value = Number(text);
  if (!integerText.test(text) || !Number.isSafeInteger(value)) {
    throw new BinferenceError({
      code: "store.integer_too_large",
      message: `Postgres returned the integer ${text}, past what a JavaScript number holds exactly; store it as numeric decimal text.`,
      details: { value: text },
    });
  }
  return value;
}

/**
 * The row parsers of a Postgres store connection, so every column reads back as SQLite gives it
 * (decision 0365): `int2`, `int4` and `int8` as numbers, an integer past
 * `Number.MAX_SAFE_INTEGER` refused with `store.integer_too_large`, and `numeric` as the decimal
 * text the server writes. Every other type keeps the driver's parser.
 */
export function rowTypes(): CustomTypesConfig {
  const types = new TypeOverrides();
  types.setTypeParser(typeIds.int8, "text", parseInteger);
  types.setTypeParser(typeIds.int2, "text", parseInteger);
  types.setTypeParser(typeIds.int4, "text", parseInteger);
  types.setTypeParser(typeIds.numeric, "text", (text: string) => text);
  return types;
}
