import { z } from "zod";

/**
 * A plain JSON document: what a JSON column, a ledger entry's data or a stored reply holds. It has
 * no `undefined`, no `bigint` and no function; amounts in it are decimal strings.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Parses a plain JSON document: finite numbers only, every value JSON can hold and no other. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.json();
