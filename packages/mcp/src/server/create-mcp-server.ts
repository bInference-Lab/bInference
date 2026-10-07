import type { ProtocolClient, ProtocolClientOptions } from "@binference/client";
import { type ArgsOf, operations, type ResultOf } from "@binference/protocol";
import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  type OperationTool,
  operationTools,
  type ToolOperation,
} from "../tools/operation-tools.js";
import { type ToolInputSchema, toolInputSchema } from "../tools/tool-input.schema.js";
import { toolAnswer } from "./tool-answer.js";
import { type ToolFailure, toolFailure } from "./tool-failure.schema.js";
import { wireResultOf } from "./wire-result.schema.js";

/** The logger the MCP server writes to: the `Logger` port its protocol client takes. */
export type McpLogger = ProtocolClientOptions["logger"];

/** What the MCP server is built from. */
export interface McpServerOptions {
  /**
   * The protocol client the tools call, signed in with a token that holds `read` and `propose`
   * only. The engine refuses anything else for that token.
   */
  readonly client: ProtocolClient;
  /** The binference release, which MCP clients see as the server's version. */
  readonly version: string;
  readonly logger: McpLogger;
}

const instructions =
  "binference is an AI agent that trades for its owner. These tools read the owner's portfolio, tokens, quotes, auto orders and ledger, and propose intents, auto orders and alerts. Every proposal waits for the owner's confirmation in Telegram or the console: no tool can confirm, deny or change a limit.";

interface ToolCall<N extends ToolOperation> {
  readonly tool: OperationTool;
  readonly operation: N;
  readonly args: ArgsOf<N>;
}

function failed(failure: ToolFailure, logger: McpLogger): CallToolResult {
  logger.warn("mcp.tool_failed", { errorCode: failure.code });
  return failure.result;
}

// The engine's result goes back as its wire JSON; a failure goes back as a tool error, so the
// model reads the code and the next step instead of a protocol error.
async function callTool<N extends ToolOperation>(
  call: ToolCall<N>,
  options: McpServerOptions,
  signal: AbortSignal,
): Promise<CallToolResult> {
  let result: ResultOf<N>;
  try {
    result = await options.client.call(call.operation, call.args, { signal });
  } catch (error) {
    return failed(toolFailure(call.tool.name, error), options.logger);
  }
  const wire = wireResultOf(operations[call.operation].result, result);
  if (wire === undefined) {
    const message = `The result of ${call.operation} breaks its schema.`;
    const failure = toolFailure(call.tool.name, { code: "client.bad_reply", message });
    return failed(failure, options.logger);
  }
  return toolAnswer(call.operation, wire);
}

/** A tool bound to its operation: its input schema and its handler share the operation's args. */
interface BoundTool<N extends ToolOperation> {
  readonly inputSchema: ToolInputSchema<ArgsOf<N>>;
  readonly answer: (args: ArgsOf<N>, signal: AbortSignal) => Promise<CallToolResult>;
}

function bindTool<N extends ToolOperation>(
  tool: OperationTool,
  operation: N,
  options: McpServerOptions,
): BoundTool<N> {
  return {
    inputSchema: toolInputSchema(operations[operation].args, tool.inputSchema),
    answer: async (args, signal) => callTool({ tool, operation, args }, options, signal),
  };
}

function registerTool(server: McpServer, tool: OperationTool, options: McpServerOptions): void {
  const bound = bindTool(tool, tool.operation, options);
  const config = {
    title: tool.title,
    description: tool.description,
    inputSchema: bound.inputSchema,
    annotations: { readOnlyHint: tool.readOnly },
  };
  server.registerTool(tool.name, config, async (args, context) =>
    bound.answer(args, context.mcpReq.signal),
  );
}

/**
 * Builds an MCP server with one tool per row of the protocol's `mcpTools`, each calling its
 * operation through the protocol client. Every tool reads or proposes; a proposal answers with
 * the intent's id and that it waits for the owner's confirmation in Telegram or the console. Tool
 * texts are English. Connect it with `serveMcpOverStdio`, or with any MCP transport.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: "binference", title: "binference", version: options.version },
    { capabilities: { tools: { listChanged: false } }, instructions },
  );
  for (const tool of operationTools()) {
    registerTool(server, tool, options);
  }
  return server;
}
