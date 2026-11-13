import { jsonValueSchema, valueNestsDeeperThan } from "@binference/core";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { z } from "zod";
import type { ListedMcpTool } from "./listing.schema.js";

/** What a listed tool's call answers the model: the server's text, or a refusal of its answer. */
export type ListedAnswer =
  | { readonly kind: "answer"; readonly text: string; readonly isError: boolean }
  | { readonly kind: "bad_answer" };

// A block the model never reads, named by one line; no link in it is opened.
const leftOut: Readonly<Record<string, string>> = {
  image: "[an image the server sent was left out]",
  audio: "[an audio clip the server sent was left out]",
  resource: "[a resource the server sent was left out]",
  resource_link: "[a link the server sent was left out, and was not opened]",
};

const outputSchemas = new WeakMap<ListedMcpTool, z.ZodType>();

// The zod schema of a tool's listed output, read once per listing's tool.
function outputSchemaOf(tool: ListedMcpTool): z.ZodType | undefined {
  if (tool.output === undefined) {
    return undefined;
  }
  const known = outputSchemas.get(tool);
  if (known !== undefined) {
    return known;
  }
  const schema = z.fromJSONSchema(tool.output);
  outputSchemas.set(tool, schema);
  return schema;
}

// The text blocks joined, and a line for each other block.
function textOf(content: CallToolResult["content"]): string {
  return content
    .map((block) =>
      block.type === "text" ? block.text : (leftOut[block.type] ?? "[a block was left out]"),
    )
    .join("\n\n");
}

// The structured content, when the listing's output schema takes it, as JSON text.
function structuredText(
  tool: ListedMcpTool,
  value: CallToolResult["structuredContent"],
): string | undefined {
  const schema = outputSchemaOf(tool);
  if (schema === undefined || valueNestsDeeperThan(value)) {
    return undefined;
  }
  const json = jsonValueSchema.safeParse(value);
  if (!json.success || !schema.safeParse(json.data).success) {
    return undefined;
  }
  return JSON.stringify(json.data);
}

/**
 * What a listed tool's result answers the model (decision 0429): for a tool with an output schema,
 * its `structuredContent` as JSON, which must pass the listing's schema; for one without, its text
 * blocks joined, each other block a line naming its type. An answer with `isError` gives the
 * server's text as the tool's error. Every answer is the server's words, outside content.
 */
export function answerOf(result: CallToolResult, tool: ListedMcpTool): ListedAnswer {
  if (result.isError === true) {
    return { kind: "answer", text: textOf(result.content), isError: true };
  }
  if (tool.output === undefined) {
    return { kind: "answer", text: textOf(result.content), isError: false };
  }
  const text = structuredText(tool, result.structuredContent);
  return text === undefined ? { kind: "bad_answer" } : { kind: "answer", text, isError: false };
}
