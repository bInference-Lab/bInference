import { z } from "zod";

/** An object with no fields: the args of an operation that takes none, or a bare answer. */
export type Empty = Readonly<Record<string, never>>;

/** Parses the args of an operation that takes none; any field is refused. */
export const emptyArgsSchema: z.ZodType<Empty> = z.strictObject({});

/** Parses a bare answer; fields a newer engine adds are dropped. */
export const emptyResultSchema: z.ZodType<Empty> = z.object({});
