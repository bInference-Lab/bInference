import { z } from "zod";
import type { CommonOptions } from "./cli-flags.schema.js";

/**
 * What `plugin add` takes: the version's npm integrity, read from npm when left out, and, for a
 * plugin without npm provenance, its name typed for a script in place of the question.
 */
export interface PluginAddFlags extends CommonOptions {
  readonly hash?: string;
  readonly name?: string;
}

const common = { json: z.boolean().default(false), yes: z.boolean().default(false) };

/** Parses the flags commander read for `plugin add`. */
export const pluginAddFlagsSchema: z.ZodType<PluginAddFlags> = z.object({
  ...common,
  hash: z
    .string()
    .regex(/^sha512-[A-Za-z0-9+/]{86}==$/)
    .exactOptional(),
  name: z.string().min(1).max(64).exactOptional(),
});
