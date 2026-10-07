import type { CallableName } from "@binference/client";
import {
  describeOperations,
  idempotencyKeySchema,
  type JsonSchema,
  mcpTools,
  type OperationName,
  type OperationShapes,
  operations,
} from "@binference/protocol";
import { z } from "zod";
import { kindFieldsText } from "./kind-fields.js";
import { toolJsonSchema } from "./tool-json-schema.js";
import { requestIdText, toolTexts } from "./tool-texts.js";

/** An operation a tool calls: any operation the protocol client's `call` takes. */
export type ToolOperation = CallableName<OperationShapes>;

/** One tool of the MCP server, built from the protocol's tool table. */
export interface OperationTool {
  /** The tool's name, such as `binference_propose`. */
  readonly name: string;
  readonly operation: ToolOperation;
  readonly title: string;
  /** What the model reads: the tool's text, then the fields of each kind for a union request. */
  readonly description: string;
  /** What `tools/list` shows: the operation's args from `engine/describe`, an object at the root. */
  readonly inputSchema: JsonSchema;
  /** Whether the operation only reads, which MCP clients learn as `readOnlyHint`. */
  readonly readOnly: boolean;
  /** Whether the tool takes an optional `requestId`, sent as the call's idempotency key. */
  readonly takesRequestId: boolean;
}

// The request id's JSON Schema is the protocol's idempotency key's, with what the model reads.
function requestIdSchema(): JsonSchema {
  const { $schema: _dialect, ...key } = z.toJSONSchema(idempotencyKeySchema, { io: "input" });
  return { ...key, description: requestIdText };
}

// A tool that takes a request id lists it as one more optional property.
function withRequestId(schema: JsonSchema): JsonSchema {
  const properties = z.record(z.string(), z.unknown()).catch({}).parse(schema["properties"]);
  return { ...schema, properties: { ...properties, requestId: requestIdSchema() } };
}

// `push/subscribe` and `push/unsubscribe` hold per-connection state; no tool may name them.
function isToolOperation(name: OperationName): name is ToolOperation {
  return name !== "push/subscribe" && name !== "push/unsubscribe";
}

/**
 * The tools of the MCP server, one per row of the protocol's `mcpTools` and in its order, each
 * with its operation's input schema from `describeOperations`, the function that answers
 * `engine/describe`, and an optional `requestId` for the tools the protocol marks. The protocol
 * maps tools to `read` and `propose` operations only, so no tool can confirm.
 */
export function operationTools(): readonly OperationTool[] {
  const described = new Map(describeOperations().operations.map((item) => [item.name, item]));
  return mcpTools.flatMap((tool): OperationTool[] => {
    const args = described.get(tool.operation)?.args;
    if (!isToolOperation(tool.operation) || args === undefined) {
      return [];
    }
    const text = toolTexts[tool.name] ?? { title: tool.name, description: tool.operation };
    const kinds = kindFieldsText(args);
    const takesRequestId = tool.takesRequestId === true;
    const inputSchema = toolJsonSchema(args);
    return [
      {
        name: tool.name,
        operation: tool.operation,
        title: text.title,
        description: kinds === undefined ? text.description : `${text.description} ${kinds}`,
        inputSchema: takesRequestId ? withRequestId(inputSchema) : inputSchema,
        readOnly: operations[tool.operation].kind === "read",
        takesRequestId,
      },
    ];
  });
}
