import type { JsonValue } from "@binference/core";
import { z } from "zod";

/** A JSON object: Claude Code's `.claude.json`, or its `mcpServers`. */
export type JsonObject = Readonly<Record<string, JsonValue>>;

/** Parses a JSON object. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), z.json());

/** Parses the text of a `.claude.json`; a file that is not a JSON object fails. */
export const claudeJsonSchema: z.ZodType<JsonObject, string> = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "Not JSON." });
      return z.NEVER;
    }
  })
  .pipe(jsonObjectSchema);
