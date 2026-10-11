import type { ConfigText } from "./client-config-file.js";
import { readConfigText, unreadableConfig, writeConfigText } from "./client-config-file.js";
import type { ClientPlaces } from "./client-places.js";
import { type McpServerEntry, serverName } from "./mcp-server-entry.js";
import type { SetupChange, SetupRun } from "./setup-change.js";

/** A Codex `config.toml` split into the `binference` server's tables and every other line. */
interface CodexTables {
  readonly others: readonly string[];
  readonly ours: readonly string[];
}

const tableHeader = /^\s*\[{1,2}([^[\]]+)\]{1,2}\s*(?:#.*)?$/;
// A `binference` server written another way than as its own table, such as a dotted key.
const otherForm = new RegExp(`^\\s*(?:mcp_servers\\s*\\.\\s*)?["']?${serverName}["']?\\s*[.=]`);

function keysOf(header: string): readonly string[] {
  return header.split(".").map((key) => key.trim().replace(/^["']|["']$/g, ""));
}

// The tables `[mcp_servers.binference]` and `[mcp_servers.binference.<sub>]` are ours.
function splitTables(text: string): CodexTables {
  const others: string[] = [];
  const ours: string[] = [];
  let isOurs = false;
  for (const line of text.split(/\r?\n/)) {
    const header = tableHeader.exec(line)?.[1];
    if (header !== undefined) {
      const [first, second] = keysOf(header);
      isOurs = first === "mcp_servers" && second === serverName;
    }
    (isOurs ? ours : others).push(line);
  }
  return { others, ours };
}

const tomlString = (text: string): string => JSON.stringify(text);

/**
 * The `[mcp_servers.binference]` table of Codex's `config.toml`, as OpenAI's Codex docs write a
 * stdio server: `command`, `args` and `env`. JSON strings are TOML basic strings.
 */
export function codexTable(entry: McpServerEntry): string {
  const env = Object.entries(entry.env).map(([name, value]) => `${name} = ${tomlString(value)}`);
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    ...(env.length === 0 ? [] : [`env = { ${env.join(", ")} }`]),
  ].join("\n");
}

/**
 * Codex's `-c` overrides that set the `binference` server for one run, as OpenAI's Codex docs give
 * `-c key=value` with a TOML value: its command, arguments and environment, and the variables of
 * Codex's own environment it passes on.
 */
export function codexOverrides(entry: McpServerEntry, variables: readonly string[]): string[] {
  const env = Object.entries(entry.env).map(([name, value]) => `${name} = ${tomlString(value)}`);
  const key = `mcp_servers.${serverName}`;
  return [
    `${key}.command=${tomlString(entry.command)}`,
    `${key}.args=[${entry.args.map(tomlString).join(", ")}]`,
    `${key}.env=${env.length === 0 ? "{}" : `{ ${env.join(", ")} }`}`,
    `${key}.env_vars=[${variables.map(tomlString).join(", ")}]`,
    `${key}.enabled=true`,
  ].flatMap((override) => ["-c", override]);
}

/**
 * Codex's `-c` override that keeps `variable` out of the commands its shell tool runs, through
 * `shell_environment_policy.filters`, which OpenAI's Codex config reference gives as the canonical
 * case-insensitive filters by name; an `exclude` there cannot be put back by an include.
 */
export function codexShellExclusion(variable: string): string[] {
  return ["-c", `shell_environment_policy.filters.${variable}="exclude"`];
}

function joined(lines: readonly string[]): string {
  return lines.join("\n").trimEnd();
}

function tablesOf(config: ConfigText): CodexTables {
  const tables = splitTables(config.text ?? "");
  if (tables.others.some((line) => otherForm.test(line))) {
    throw unreadableConfig(config.file);
  }
  return tables;
}

/**
 * Sets the `binference` server in Codex's `config.toml`: its own tables are replaced by one table
 * at the end, every other line kept as it is. The same table changes nothing; a server written
 * another way, such as with dotted keys, leaves the file as it is and fails.
 */
export async function setCodexServer(
  run: SetupRun,
  entry: McpServerEntry,
  places: ClientPlaces,
): Promise<SetupChange> {
  const config = await readConfigText(places.config, run.signal);
  const tables = tablesOf(config);
  const table = codexTable(entry);
  if (joined(tables.ours) === table) {
    return { part: "server", action: "unchanged", path: places.config };
  }
  if (!run.isDryRun) {
    const rest = joined(tables.others);
    const next = `${rest === "" ? "" : `${rest}\n\n`}${table}\n`;
    await writeConfigText(run, { ...config, next }, places);
  }
  const action = tables.ours.length === 0 ? "created" : "updated";
  return { part: "server", action, path: places.config };
}

/** Removes the `binference` server's tables from Codex's `config.toml`, keeping every other line. */
export async function removeCodexServer(run: SetupRun, places: ClientPlaces): Promise<SetupChange> {
  const config = await readConfigText(places.config, run.signal);
  const tables = tablesOf(config);
  if (tables.ours.length === 0) {
    return { part: "server", action: "absent", path: places.config };
  }
  if (!run.isDryRun) {
    const rest = joined(tables.others);
    await writeConfigText(run, { ...config, next: rest === "" ? "" : `${rest}\n` }, places);
  }
  return { part: "server", action: "removed", path: places.config };
}
