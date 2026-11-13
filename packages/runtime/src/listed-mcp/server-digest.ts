import { createHash } from "node:crypto";
import { type JsonValue, stableJson } from "@binference/core";

/** What a listed tool's digest covers of the server's own definition (decision 0429). */
export interface ServerToolDefinition {
  readonly name: string;
  readonly inputSchema: JsonValue;
  readonly outputSchema?: JsonValue;
}

/**
 * The SHA-256, in hex, of a tool's `name`, `inputSchema` and `outputSchema` as canonical JSON
 * (RFC 8785: keys sorted by UTF-16 code units, no spaces). Its description and annotations are
 * left out: the model never reads them, so an edit of the server's words alone changes nothing.
 */
export function serverDigestOf(tool: ServerToolDefinition): string {
  const covered: JsonValue = {
    name: tool.name,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
  };
  return createHash("sha256").update(stableJson(covered), "utf8").digest("hex");
}
