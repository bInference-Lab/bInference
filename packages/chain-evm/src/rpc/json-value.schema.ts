import { z } from "zod";

/** A JSON value, as JSON-RPC carries params, results and error data. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Checks that a value is plain JSON: no `undefined`, no `bigint`, no function. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** Checks the params of a JSON-RPC request. */
export const jsonParamsSchema: z.ZodType<readonly JsonValue[]> = z.array(jsonValueSchema);
