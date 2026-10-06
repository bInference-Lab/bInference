import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema, shortTextSchema } from "../records/record-fields.js";

/**
 * One change to the config, as the config journal records it: who made it, on which surface, the
 * path and its value before and after. `before` is absent for a new key, `after` for a removed one.
 */
export interface ConfigChange {
  readonly atMs: number;
  /** Who changed it: a client token, a console device, `telegram` or `engine`. */
  readonly by: string;
  readonly surface: string;
  /** The config path, such as `agents.main.limits.perTradeUsd`. */
  readonly path: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly reason?: string;
}

const changeShape = {
  atMs: epochMsSchema,
  by: shortTextSchema,
  surface: shortTextSchema,
  path: z.string().min(1).max(512),
  before: jsonValueSchema.exactOptional(),
  after: jsonValueSchema.exactOptional(),
  reason: z.string().min(1).max(1_000).exactOptional(),
};

/** Parses a config change. */
export const configChangeSchema: z.ZodType<ConfigChange> = z.strictObject(changeShape);

/** A config change in the journal, numbered in the order it was recorded. */
export interface ConfigJournalEntry extends ConfigChange {
  readonly id: number;
}

/** Parses a config journal entry. */
export const configJournalEntrySchema: z.ZodType<ConfigJournalEntry> = z.strictObject({
  ...changeShape,
  id: rowNumberSchema,
});
