import { homedir } from "node:os";
import { join } from "node:path";
import type { McpClient } from "../compose/mcp-token.js";
import type { CliHost } from "../program/cli-host.js";

/** The bundled skill's folder name, the same in every client. */
export const skillName = "binference-tools";

/** Where a client keeps its MCP servers, the home folder that file sits in, and its skills. */
export interface ClientPlaces {
  readonly home: string;
  /** The file that holds the client's user MCP servers. */
  readonly config: string;
  /** The folder the bundled skill goes in. */
  readonly skill: string;
}

function variable(host: Pick<CliHost, "env">, name: string): string | undefined {
  const value = host.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Where each client reads its user MCP servers and personal skills, as its docs name them. Claude
 * Code: `~/.claude.json` and `~/.claude/skills/`, both under `CLAUDE_CONFIG_DIR` when it is set.
 * Codex: `config.toml` in `CODEX_HOME` (`~/.codex` when unset), and `~/.agents/skills/`.
 */
export function clientPlaces(
  host: Pick<CliHost, "env" | "homeDir">,
  client: McpClient,
): ClientPlaces {
  const home = host.homeDir ?? homedir();
  if (client === "codex") {
    return {
      home,
      config: join(variable(host, "CODEX_HOME") ?? join(home, ".codex"), "config.toml"),
      skill: join(home, ".agents", "skills", skillName),
    };
  }
  const configDir = variable(host, "CLAUDE_CONFIG_DIR");
  return {
    home,
    config: join(configDir ?? home, ".claude.json"),
    skill: join(configDir ?? join(home, ".claude"), "skills", skillName),
  };
}
