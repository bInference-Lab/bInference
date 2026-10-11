import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { lintSkill } from "@binference/plugin-sdk";
import { mcpClientNames } from "../compose/mcp-token.js";
import { type BundledSkill, readBundledSkill } from "../mcp-setup/bundled-skill.js";
import { removeClaudeServer, setClaudeServer } from "../mcp-setup/claude-code-server.js";
import { type ClientPlaces, clientPlaces } from "../mcp-setup/client-places.js";
import { ensureClientToken, revokeClientToken } from "../mcp-setup/client-token.js";
import { removeCodexServer, setCodexServer } from "../mcp-setup/codex-server.js";
import { mcpServerEntry } from "../mcp-setup/mcp-server-entry.js";
import type { SetupChange, SetupRun } from "../mcp-setup/setup-change.js";
import { installSkill, removeSkill } from "../mcp-setup/skill-files.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { McpSetupFlags } from "../program/mcp-flags.schema.js";
import { withEngineWithin } from "./connect-engine.js";

// A `claude mcp` call may take up to 15 seconds; the setup makes at most two.
const setupBudgetMs = 60_000;

async function setUp(run: SetupRun, skill: BundledSkill, engine: ProtocolClient) {
  const places = clientPlaces(run.host, run.client);
  const entry = mcpServerEntry(run.host, run.client);
  const token = await ensureClientToken(run, engine);
  const server =
    run.client === "codex"
      ? await setCodexServer(run, entry, places)
      : await setClaudeServer(run, entry, places);
  return [token, server, await installSkill(run, skill, places.skill)];
}

async function undo(run: SetupRun, places: ClientPlaces, engine: ProtocolClient) {
  const server =
    run.client === "codex"
      ? await removeCodexServer(run, places)
      : await removeClaudeServer(run, places);
  const skill = await removeSkill(run, places.skill);
  return [server, skill, await revokeClientToken(run, engine)];
}

function endKey(flags: McpSetupFlags): string {
  if (flags.isDryRun) {
    return "mcpSetup.dryRun";
  }
  return flags.isRemove ? "mcpSetup.removed" : "mcpSetup.done";
}

function report(run: CommandRun, flags: McpSetupFlags, changes: readonly SetupChange[]): void {
  const { output, formatter } = run;
  const client = mcpClientNames[flags.client];
  const listed = changes.map(({ part, action, path, expiresAt }) => ({
    part,
    action,
    path,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }));
  output.json({
    client: flags.client,
    dryRun: flags.isDryRun,
    remove: flags.isRemove,
    changes: listed,
  });
  for (const { expiresAt, ...change } of changes) {
    output.say(flags.isDryRun ? "mcpSetup.plan" : "mcpSetup.change", { ...change });
    if (expiresAt !== undefined) {
      output.say("mcpSetup.expires", { at: formatter.dateTime(expiresAt) });
    }
  }
  output.say(endKey(flags), { client });
}

// The failures a person can fix in their own files; any other fault is the CLI's to report.
function reportSetupFault(output: CliOutput, error: ErrorOptions["cause"]): ExitCode {
  if (!(error instanceof BinferenceError)) {
    throw error;
  }
  const file = typeof error.details?.["file"] === "string" ? error.details["file"] : "";
  switch (error.code) {
    case "cli.client_config_unreadable":
      output.fail({ code: error.code, key: "mcpSetup.unreadable", values: { file } });
      return 1;
    case "cli.claude_failed":
      output.fail({ code: error.code, key: "mcpSetup.claudeFailed" });
      return 1;
    default:
      throw error;
  }
}

/**
 * `binference mcp setup --client <claude-code|codex>`: gives the client a token of its own, writes
 * its MCP server entry at user scope and installs the bundled `binference-tools` skill, after
 * `lintSkill` passes it. A second run changes only what differs; `--dry-run` says what would
 * change and changes nothing; `--remove` takes the entry and the skill away and revokes the
 * token. It needs the running engine for the token, and prints each change.
 */
export async function runMcpSetup(run: CommandRun, flags: McpSetupFlags): Promise<ExitCode> {
  const { host, output } = run;
  const skill = await readBundledSkill(AbortSignal.timeout(5_000));
  if (skill === undefined) {
    output.fail({ code: "cli.no_skill", key: "mcpSetup.noSkill" });
    return 1;
  }
  const [finding] = lintSkill(skill.skillMd);
  if (finding !== undefined) {
    output.fail({
      code: "cli.skill_lint",
      key: "mcpSetup.skillLint",
      values: { line: finding.line },
    });
    return 1;
  }
  return withEngineWithin(host, output, {
    budgetMs: setupBudgetMs,
    use: async (engine, signal) => {
      const ttl = flags.ttlMs === undefined ? {} : { ttlMs: flags.ttlMs };
      const setup = { host, client: flags.client, isDryRun: flags.isDryRun, signal, ...ttl };
      try {
        const changes = flags.isRemove
          ? await undo(setup, clientPlaces(host, flags.client), engine)
          : await setUp(setup, skill, engine);
        report(run, flags, changes);
        return 0;
      } catch (error) {
        return reportSetupFault(output, error);
      }
    },
  });
}
