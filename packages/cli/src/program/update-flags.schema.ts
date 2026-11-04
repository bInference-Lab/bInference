import { z } from "zod";
import type { CommonOptions } from "./cli-flags.schema.js";

/** What `update` takes: `--to`, a release in place of the newest on the channel, and `--set`. */
export interface UpdateFlags extends CommonOptions {
  readonly to?: string;
  /**
   * Each `--set key=value` the engine starts with after the update, as `binference start` takes
   * them: the service is installed again without the flags it ran with otherwise.
   */
  readonly sets: readonly string[];
}

/** Parses the options commander read for `update`. */
export const updateFlagsSchema: z.ZodType<UpdateFlags> = z
  .object({
    json: z.boolean().default(false),
    yes: z.boolean().default(false),
    to: z.string().min(1).max(64).exactOptional(),
    set: z.array(z.string()).default([]),
  })
  .transform(({ set, ...rest }) => ({ ...rest, sets: set }));
