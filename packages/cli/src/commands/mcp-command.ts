import type { Readable, Writable } from "node:stream";
import { createProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { serveMcpOverStdio } from "@binference/mcp";
import { operations } from "@binference/protocol";
import { readCliToken } from "../compose/cli-token.js";
import { engineEndpoint, platformOf } from "../compose/engine-locations.js";
import { mcpTokenFile } from "../compose/mcp-token.js";
import { createFileLogger } from "../logging/file-logger.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { McpFlags } from "../program/mcp-flags.schema.js";
import { ipcWebSocket } from "./connect-engine.js";

/** The streams `binference mcp` serves over: what the MCP client writes, and where it reads. */
export interface McpStdio {
  readonly input: Readable;
  readonly output: Writable;
}

/**
 * `binference mcp`: the MCP server an MCP client starts. It signs in to the engine over IPC with
 * the client's token from the state folder, which holds `read` and `propose` only, and serves the
 * tools over the host's stdio until the client closes it or a stop signal arrives. Tools list
 * while the engine is down. Stdout carries MCP messages only: logs go to stderr as JSON lines, and
 * a missing token file is one message on stderr and exit 1.
 */
export async function runMcp(run: CommandRun, flags: McpFlags): Promise<ExitCode> {
  const { host, output } = run;
  const stdio = host.mcpStdio;
  if (stdio === undefined) {
    throw new BinferenceError({ code: "cli.no_stdio", message: "The host gives MCP no stdio." });
  }
  const platform = platformOf(host);
  const file = mcpTokenFile(platform.stateFolder, flags.client);
  const token = await readCliToken(file, AbortSignal.timeout(5_000));
  if (token === undefined) {
    output.fail({ code: "cli.no_mcp_token", key: "mcp.noToken", values: { file } });
    return 1;
  }
  const logger = createFileLogger({
    file: { append: (line) => host.err(`${line}\n`), close: async () => Promise.resolve() },
    level: () => "info",
    clock: host.clock,
    subsystem: "mcp",
  });
  const endpoint = engineEndpoint(platform);
  const client = createProtocolClient({
    operations,
    openSocket: () => ipcWebSocket(endpoint.address),
    client: { kind: "mcp", version: host.version },
    credential: { token },
    clock: host.clock,
    random: host.random,
    logger,
  });
  const stopped = new AbortController();
  const onStop = (): void => stopped.abort();
  platform.stopSignals.forEach((name) => host.signals.on(name, onStop));
  try {
    await serveMcpOverStdio(
      { client, version: host.version, logger, streams: stdio },
      stopped.signal,
    );
  } finally {
    platform.stopSignals.forEach((name) => host.signals.off(name, onStop));
    await logger.close();
  }
  return 0;
}
