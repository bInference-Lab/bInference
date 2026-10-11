import { join } from "node:path";
import type { StateFolder } from "@binference/platform";

/** The MCP clients `binference mcp setup` sets up, each with a token of its own (decision 0154). */
export const mcpClients = ["claude-code", "codex"] as const;

/** One MCP client `binference mcp setup` knows. */
export type McpClient = (typeof mcpClients)[number];

/**
 * The token file `binference mcp` signs in with, owner-only in the state folder: the client's own,
 * `auth/mcp-<client>.token`, or `auth/mcp.token` when no client is named.
 */
export function mcpTokenFile(stateFolder: StateFolder, client?: McpClient): string {
  const name = client === undefined ? "mcp.token" : `mcp-${client}.token`;
  return join(stateFolder.root, "auth", name);
}
