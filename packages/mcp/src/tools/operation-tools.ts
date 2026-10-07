import type { CallableName } from "@binference/client";
import {
  describeOperations,
  type JsonSchema,
  mcpTools,
  type OperationName,
  type OperationShapes,
  operations,
} from "@binference/protocol";
import { kindFieldsText } from "./kind-fields.js";
import { toolJsonSchema } from "./tool-json-schema.js";
import { toolTexts } from "./tool-texts.js";

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
}

// `push/subscribe` and `push/unsubscribe` hold per-connection state; no tool may name them.
function isToolOperation(name: OperationName): name is ToolOperation {
  return name !== "push/subscribe" && name !== "push/unsubscribe";
}

/**
 * The tools of the MCP server, one per row of the protocol's `mcpTools` and in its order, each
 * with its operation's input schema from `describeOperations`, the function that answers
 * `engine/describe`. The protocol maps tools to `read` and `propose` operations only, so no tool
 * can confirm.
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
    return [
      {
        name: tool.name,
        operation: tool.operation,
        title: text.title,
        description: kinds === undefined ? text.description : `${text.description} ${kinds}`,
        inputSchema: toolJsonSchema(args),
        readOnly: operations[tool.operation].kind === "read",
      },
    ];
  });
}
