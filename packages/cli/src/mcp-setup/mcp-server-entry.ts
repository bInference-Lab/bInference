import type { McpClient } from "../compose/mcp-token.js";
import type { CliHost } from "../program/cli-host.js";

/** The MCP server's name in every client's config. */
export const serverName = "binference";

/** How a client starts `binference mcp`: the program, its arguments and its environment. */
export interface McpServerEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The client's MCP server entry: this binference, started as the background service starts it,
 * running `mcp --client <client>`, with `BINFERENCE_HOME` when the setup ran with one. It holds
 * no secret: the token stays in the state folder.
 */
export function mcpServerEntry(
  host: Pick<CliHost, "entry" | "env">,
  client: McpClient,
): McpServerEntry {
  const home = host.env["BINFERENCE_HOME"];
  return {
    command: host.entry.node,
    args: [...host.entry.nodeOptions, host.entry.script, "mcp", "--client", client],
    env: home === undefined || home === "" ? {} : { BINFERENCE_HOME: home },
  };
}
