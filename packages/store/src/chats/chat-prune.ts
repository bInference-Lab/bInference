import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** What chat retention removes: everything of the chats before `beforeMs`. */
export interface ChatPrune {
  readonly beforeMs: number;
}

/** How many rows a prune removed, by table. */
export interface ChatPruned {
  readonly events: number;
  readonly turns: number;
  readonly messages: number;
}

/** Parses a fenced prune. */
export const chatPruneSchema: z.ZodType<Fenced<ChatPrune>> = z.strictObject({
  beforeMs: z.int().nonnegative(),
  fence: fenceSchema,
});

const countSchema = z.int().nonnegative();

/** Parses a prune's counts. */
export const chatPrunedSchema: z.ZodType<ChatPruned> = z.strictObject({
  events: countSchema,
  turns: countSchema,
  messages: countSchema,
});
