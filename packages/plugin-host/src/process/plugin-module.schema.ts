import { BinferenceError, type JsonValue, jsonValueSchema } from "@binference/core";
import type { CommunityTools, ToolRun } from "@binference/plugin-sdk/community";
import { z } from "zod";

const moduleSchema = z.object({
  tools: z.record(
    z.string(),
    z.custom<ToolRun>((value) => typeof value === "function"),
  ),
});

const codePattern = /^[a-z][a-z0-9_.]{0,63}$/;

/**
 * The tools a plugin's entry module exports as `tools`, each a function. A module without them
 * throws `plugin.no_tools`.
 */
export function toolsOfModule(loaded: unknown): CommunityTools {
  const parsed = moduleSchema.safeParse(loaded);
  if (!parsed.success) {
    throw new BinferenceError({
      code: "plugin.no_tools",
      message: "The plugin's entry module exports no `tools` of functions.",
    });
  }
  return parsed.data.tools;
}

/** A tool's answer as JSON, or none when it is not JSON (a function, `undefined`, a cycle). */
export function jsonOutputOf(value: unknown): JsonValue | undefined {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The code a failed tool call reports: a `BinferenceError`'s code, else `plugin.tool_failed`. */
export function failureCodeOf(error: unknown): string {
  const code = error instanceof BinferenceError ? error.code : undefined;
  return code !== undefined && codePattern.test(code) ? code : "plugin.tool_failed";
}
