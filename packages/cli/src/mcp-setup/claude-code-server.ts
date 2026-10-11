import { isDeepStrictEqual } from "node:util";
import { BinferenceError, type JsonValue } from "@binference/core";
import { runCommandToExit } from "@binference/platform";
import { claudeJsonSchema, type JsonObject, jsonObjectSchema } from "./claude-json.schema.js";
import {
  type ConfigText,
  readConfigText,
  unreadableConfig,
  writeConfigText,
} from "./client-config-file.js";
import type { ClientPlaces } from "./client-places.js";
import { type McpServerEntry, serverName } from "./mcp-server-entry.js";
import type { SetupChange, SetupRun } from "./setup-change.js";

interface ClaudeConfig extends ConfigText {
  readonly keys: JsonObject;
  readonly servers: JsonObject;
}

async function readClaudeConfig(file: string, signal: AbortSignal): Promise<ClaudeConfig> {
  const config = await readConfigText(file, signal);
  const keys = claudeJsonSchema.safeParse(config.text ?? "{}");
  const servers = keys.success ? jsonObjectSchema.safeParse(keys.data["mcpServers"] ?? {}) : keys;
  if (!keys.success || !servers.success) {
    throw unreadableConfig(file);
  }
  return { ...config, keys: keys.data, servers: servers.data };
}

function claudeEntryOf(entry: McpServerEntry): JsonValue {
  return { type: "stdio", command: entry.command, args: [...entry.args], env: { ...entry.env } };
}

// `claude mcp` at user scope, as Claude Code's docs give it; `false` when `claude` is not on PATH.
async function claudeMcp(args: readonly string[], signal: AbortSignal): Promise<number | false> {
  try {
    return (await runCommandToExit("claude", ["mcp", ...args], signal)).exitCode;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "platform.command_failed") {
      return false;
    }
    throw error;
  }
}

function claudeFailed(): BinferenceError {
  return new BinferenceError({ code: "cli.claude_failed", message: "claude mcp failed." });
}

async function writeServers(
  run: SetupRun,
  config: ClaudeConfig,
  places: ClientPlaces,
): Promise<void> {
  const next = `${JSON.stringify(config.keys, null, 2)}\n`;
  await writeConfigText(run, { ...config, next }, places);
}

/**
 * Sets the `binference` server at Claude Code's user scope: through `claude mcp add-json` when
 * `claude` is on PATH, a changed entry removed first, else in the config file Claude Code's docs
 * name, keeping every other key. An entry that is already the same changes nothing.
 */
export async function setClaudeServer(
  run: SetupRun,
  entry: McpServerEntry,
  places: ClientPlaces,
): Promise<SetupChange> {
  const config = await readClaudeConfig(places.config, run.signal);
  const wanted = claudeEntryOf(entry);
  const current = config.servers[serverName];
  const action = current === undefined ? "created" : "updated";
  if (isDeepStrictEqual(current, wanted)) {
    return { part: "server", action: "unchanged", path: places.config };
  }
  if (run.isDryRun) {
    return { part: "server", action, path: places.config };
  }
  const removed =
    current === undefined
      ? 0
      : await claudeMcp(["remove", "--scope", "user", serverName], run.signal);
  const added =
    removed === false
      ? false
      : await claudeMcp(
          ["add-json", "--scope", "user", serverName, JSON.stringify(wanted)],
          run.signal,
        );
  if (added === false) {
    const servers = { ...config.servers, [serverName]: wanted };
    await writeServers(run, { ...config, keys: { ...config.keys, mcpServers: servers } }, places);
  } else if (added !== 0) {
    throw claudeFailed();
  }
  return { part: "server", action, path: places.config };
}

/** Removes the `binference` server from Claude Code's user scope, as {@link setClaudeServer} set it. */
export async function removeClaudeServer(
  run: SetupRun,
  places: ClientPlaces,
): Promise<SetupChange> {
  const config = await readClaudeConfig(places.config, run.signal);
  if (config.servers[serverName] === undefined) {
    return { part: "server", action: "absent", path: places.config };
  }
  if (!run.isDryRun) {
    const removed = await claudeMcp(["remove", "--scope", "user", serverName], run.signal);
    if (removed === false) {
      const { [serverName]: _gone, ...servers } = config.servers;
      await writeServers(run, { ...config, keys: { ...config.keys, mcpServers: servers } }, places);
    } else if (removed !== 0) {
      throw claudeFailed();
    }
  }
  return { part: "server", action: "removed", path: places.config };
}
