import process from "node:process";
import type { Readable, Writable } from "node:stream";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMcpServer, type McpServerOptions } from "./create-mcp-server.js";
import { codedErrorOf } from "./tool-failure.schema.js";

/** The streams MCP runs over: what the MCP client writes and where the server answers. */
export interface McpStreams {
  readonly input: Readable;
  readonly output: Writable;
}

/** What `serveMcpOverStdio` takes: the server's options and, for tests, its streams. */
export interface McpStdioOptions extends McpServerOptions {
  /** The process's stdin and stdout when absent. */
  readonly streams?: McpStreams;
}

// Resolves once the MCP client closes its end of the input, or the signal aborts.
async function untilEnded(input: Readable, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const stop = new AbortController();
    const end = (): void => {
      stop.abort();
      input.off("end", end);
      input.off("close", end);
      resolve();
    };
    input.once("end", end);
    input.once("close", end);
    signal.addEventListener("abort", end, { signal: stop.signal });
    if (signal.aborted || input.readableEnded || input.destroyed) {
      end();
    }
  });
}

// The engine may be down when the MCP client starts the server: tools still list, and each call
// waits for the connection until its timeout. A connection that fails for good closes the
// protocol client, and every later call answers with the reason.
async function connectEngine(options: McpStdioOptions, signal: AbortSignal): Promise<void> {
  try {
    await options.client.connect(signal);
  } catch (error) {
    const errorCode = codedErrorOf(error)?.code ?? "unexpected";
    options.logger.warn("mcp.engine_unreachable", { errorCode });
  }
}

/**
 * Serves the MCP tools over stdio until the MCP client closes the server's stdin or the signal
 * aborts, then closes the MCP connection and the protocol client. It connects the protocol client
 * at once, without waiting for the engine: tools list while the engine is down. Stdout carries
 * MCP messages only, so nothing else may write to it; logs go through the logger.
 */
export async function serveMcpOverStdio(
  options: McpStdioOptions,
  signal: AbortSignal,
): Promise<void> {
  const input = options.streams?.input ?? process.stdin;
  const output = options.streams?.output ?? process.stdout;
  const ended = untilEnded(input, signal);
  const handle = serveStdio(() => createMcpServer(options), {
    transport: new StdioServerTransport(input, output),
    onerror: () => options.logger.warn("mcp.stdio_error"),
  });
  void connectEngine(options, signal);
  await ended;
  await handle.close();
  options.client.close();
  options.logger.info("mcp.closed");
}
