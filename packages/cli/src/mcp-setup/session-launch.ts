import { Buffer } from "node:buffer";
import { join } from "node:path";
import type { JsonValue } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import { type McpClient, mcpTokenVariable } from "../compose/mcp-token.js";
import type { CliHost } from "../program/cli-host.js";
import { claudeEntryOf } from "./claude-code-server.js";
import { codexOverrides, codexShellExclusion } from "./codex-server.js";
import { mcpServerEntry, serverName } from "./mcp-server-entry.js";

/** How a client starts for one MCP session. Its arguments never hold the session's secret. */
export interface SessionLaunch {
  /** The client's program on PATH: `claude` or `codex`. */
  readonly program: string;
  /** The arguments that load binference's server, before the person's own. */
  readonly args: readonly string[];
  /**
   * The variables added to the client's own environment: the secret for Codex, which can take it
   * no other way, and none for Claude Code. `BINFERENCE_MCP_TOKEN` is otherwise left out of it.
   */
  readonly clientEnv: Readonly<Record<string, string>>;
  /**
   * Claude Code's MCP config, which the session writes owner-only to `file`, with the secret in
   * the `binference` server's `env` alone; Codex takes all in `args`.
   */
  readonly config?: { readonly file: string; readonly json: JsonValue };
}

// A file of the state folder's `tmp/`, named at random so sessions side by side never share one.
function configFileOf(host: Pick<CliHost, "env" | "homeDir" | "random">): string {
  const name = `mcp-session-${Buffer.from(host.random.bytes(8)).toString("hex")}.json`;
  return join(platformOf(host).stateFolder.root, "tmp", name);
}

/**
 * How the client starts for one session (decisions 0159 and 0165). Claude Code gets
 * `--strict-mcp-config --mcp-config <file>`, as its CLI reference gives them, so it loads only
 * binference's server from a config file in the state folder, whose `env` carries `secret` to that
 * server alone. Codex gets `-c` overrides of its `binference` server that pass
 * `BINFERENCE_MCP_TOKEN` on from its environment, and one that keeps the variable out of its shell
 * commands; its other servers stay. Without a `secret` (`--print-config`), Claude Code's server
 * takes the variable from the environment its owner sets.
 */
export function sessionLaunch(host: CliHost, client: McpClient, secret?: string): SessionLaunch {
  const entry = mcpServerEntry(host, client);
  if (client === "codex") {
    return {
      program: "codex",
      args: [
        ...codexOverrides(entry, [mcpTokenVariable]),
        ...codexShellExclusion(mcpTokenVariable),
      ],
      clientEnv: secret === undefined ? {} : { [mcpTokenVariable]: secret },
    };
  }
  const file = configFileOf(host);
  const server =
    secret === undefined ? entry : { ...entry, env: { ...entry.env, [mcpTokenVariable]: secret } };
  const json = { mcpServers: { [serverName]: claudeEntryOf(server) } };
  return {
    program: "claude",
    args: ["--strict-mcp-config", "--mcp-config", file],
    clientEnv: {},
    config: { file, json },
  };
}
