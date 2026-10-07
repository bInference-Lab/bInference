import type { JsonSchema } from "@binference/protocol";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";

/** A tool's input schema: any JSON in, the operation's decoded args out. */
export type ToolInputSchema<Args> = StandardSchemaWithJSON<unknown, Args>;

/**
 * A tool's input schema as the MCP SDK takes it: `json` is what `tools/list` shows, and the
 * operation's own args schema checks each `tools/call` and hands the handler the decoded args, so
 * an amount arrives as a `bigint`. A call the args schema refuses never reaches the engine.
 */
export function toolInputSchema<Args>(
  args: z.ZodType<Args>,
  json: JsonSchema,
): ToolInputSchema<Args> {
  const copy = (): Record<string, unknown> => ({ ...json });
  return {
    "~standard": {
      version: 1,
      vendor: "binference",
      validate: (value: unknown) => args["~standard"].validate(value),
      jsonSchema: { input: copy, output: copy },
    },
  };
}
