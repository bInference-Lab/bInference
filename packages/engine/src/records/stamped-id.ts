import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "./record-fields.js";

/** A row named by its id and the time of one change to it, such as a use or a revoke. */
export interface StampedId<P extends string> {
  readonly id: Id<P>;
  readonly atMs: number;
}

/** Builds the schema of a stamped id with one prefix. */
export function stampedIdSchema<P extends string>(prefix: P): z.ZodType<StampedId<P>> {
  return z.strictObject({ id: idSchema(prefix), atMs: epochMsSchema });
}
