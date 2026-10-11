import { Buffer } from "node:buffer";
import { join } from "node:path";
import type { JsonValue } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import { type McpClient, mcpTokenVariable } from "../compose/mcp-token.js";
import type { CliHost } from "../program/cli-host.js";
import { claudeEntryOf } from "./claude-code-server.js";
import { codexOverrides } from "./codex-server.js";
import { mcpServerEntry, serverName } from "./mcp-server-entry.js";

/** How a client starts for one MCP session. None of it holds the session's secret. */
export interface SessionLaunch {
  /** The client's program on PATH: `claude` or `codex`. */
  readonly program: string;
  /** The arguments that load binference's server, before the person's own. */
  readonly args: readonly string[];
  /** Claude Code's MCP config, which the session writes to `file`; Codex takes all in `args`. */
  readonly config?: { readonly file: string; readonly json: JsonValue };
}

// A file of the state folder's `tmp/`, named at random so sessions side by side never share one.
function configFileOf(host: Pick<CliHost, "env" | "homeDir" | "random">): string {
  const name = `mcp-session-${Buffer.from(host.random.bytes(8)).toString("hex")}.json`;
  return join(platformOf(host).stateFolder.root, "tmp", name);
}

/**
 * How the client starts for one session (decision 0159). Claude Code gets
 * `--strict-mcp-config --mcp-config <file>`, as its CLI reference gives them, so it loads only
 * binference's server from a config file in the state folder. Codex gets `-c` overrides of its
 * `binference` server that pass `BINFERENCE_MCP_TOKEN` on to it; its other servers stay.
 */
export function sessionLaunch(host: CliHost, client: McpClient): SessionLaunch {
  const entry = mcpServerEntry(host, client);
  if (client === "codex") {
    return { program: "codex", args: codexOverrides(entry, [mcpTokenVariable]) };
  }
  const file = configFileOf(host);
  const json = { mcpServers: { [serverName]: claudeEntryOf(entry) } };
  return {
    program: "claude",
    args: ["--strict-mcp-config", "--mcp-config", file],
    config: { file, json },
  };
}
