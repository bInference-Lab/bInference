import { z } from "zod";
import type { Brand } from "../brand.js";

/** An id: a UUIDv7 behind a type prefix, such as `int_0190f1c2-...`. `P` is the prefix. */
export type Id<P extends string> = Brand<`${P}_${string}`, P>;

const prefixPattern = /^[a-z]{2,4}$/;
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether a text is a valid id prefix: two to four lowercase letters. */
export function isIdPrefix(prefix: string): boolean {
  return prefixPattern.test(prefix);
}

/** Whether a text is an id with the given prefix and a lowercase UUIDv7 after it. */
export function isId<P extends string>(prefix: P, text: string): text is Id<P> {
  return text.startsWith(`${prefix}_`) && uuidV7Pattern.test(text.slice(prefix.length + 1));
}

/** Builds the schema that parses ids with one prefix. */
export function idSchema<P extends string>(prefix: P): z.ZodType<Id<P>, string> {
  return z
    .string()
    .refine((text): text is Id<P> => isId(prefix, text), { message: `Expected a ${prefix}_ id.` });
}
