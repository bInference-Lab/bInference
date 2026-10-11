import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

// The recorded run of the binference-tools skill: Claude Code, run headless in a home and config
// folder of its own with the skill installed there, asks the run's MCP server to "swap 0.01 BNB to
// USDT". The server is the engine on paper with the fake chain and venue, under BNB Smart Chain's
// names, and records every tool call it gets with the verdict. This script prints the verdict and
// leaves every file of the run in its output folder:
//
//   pnpm skill:run [--model <model>] [--out <folder>]
//
// Claude Code signs in with ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`)
// from this process's environment; nothing else of the owner's Claude setup is read or changed.

const prompt = "swap 0.01 BNB to USDT";
// The skeleton's agent, which the run's engine stores and the run must find; the record names it.
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const root = fileURLToPath(new URL("..", import.meta.url));
const skillFolder = join(root, "skills", "binference-tools");
const serverFile = join(root, "packages", "cli", "src", "skill-run", "skill-run-server.ts");
const loader = import.meta.resolve("tsx");
const authNames = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;
const runBudgetMs = 10 * 60_000;
const maxTurns = "12";

const recordSchema = z.object({
  ids: z.object({ agent: z.string() }),
  calls: z.array(z.looseObject({ tool: z.string() })),
  verdict: z.object({ passed: z.boolean(), problems: z.array(z.string()) }),
});

interface RunFolders {
  readonly out: string;
  readonly home: string;
  readonly config: string;
  readonly project: string;
  readonly record: string;
  readonly mcpConfig: string;
}

function fail(message: string): never {
  console.error(`skill-run: ${message}`);
  process.exit(2);
}

function foldersOf(out: string): RunFolders {
  const home = join(out, "home");
  const config = join(home, ".claude");
  return {
    out,
    home,
    config,
    project: join(out, "project"),
    record: join(out, "record.json"),
    mcpConfig: join(out, "mcp.json"),
  };
}

// The scratch home with the skill where Claude Code reads personal skills, an empty project, and
// the MCP server's config. Nothing names the agent or a token's id: the run finds them through the
// MCP tools.
function prepare(folders: RunFolders): void {
  rmSync(folders.record, { force: true });
  rmSync(folders.project, { recursive: true, force: true });
  cpSync(skillFolder, join(folders.config, "skills", "binference-tools"), { recursive: true });
  mkdirSync(folders.project, { recursive: true });
  const server = {
    type: "stdio",
    command: process.execPath,
    args: ["--conditions=@binference/source", "--import", loader, serverFile],
    env: { SKILL_RUN_RECORD: folders.record, BINFERENCE_HOME: join(folders.out, "binference") },
  };
  writeFileSync(
    folders.mcpConfig,
    `${JSON.stringify({ mcpServers: { binference: server } }, null, 2)}\n`,
  );
}

function authEnv(): Readonly<Record<string, string>> {
  const name = authNames.find((item) => (process.env[item] ?? "") !== "");
  if (name === undefined) {
    fail(
      `set ${authNames.join(" or ")} so Claude Code can sign in; run \`claude setup-token\` for a token.`,
    );
  }
  return { [name]: process.env[name] ?? "" };
}

// Only what Claude Code needs: no variable of the owner's own Claude setup reaches it.
function claudeEnv(folders: RunFolders): Readonly<Record<string, string>> {
  return {
    PATH: process.env["PATH"] ?? "",
    TMPDIR: process.env["TMPDIR"] ?? tmpdir(),
    LANG: "en_US.UTF-8",
    HOME: folders.home,
    CLAUDE_CONFIG_DIR: folders.config,
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    MCP_TIMEOUT: "60000",
    ...authEnv(),
  };
}

function runClaude(folders: RunFolders, model: string | undefined): number {
  const args = [
    "-p",
    prompt,
    `--mcp-config=${folders.mcpConfig}`,
    "--strict-mcp-config",
    "--permission-mode=dontAsk",
    "--allowedTools=mcp__binference,Skill,Read",
    "--output-format=stream-json",
    "--verbose",
    "--no-session-persistence",
    `--max-turns=${maxTurns}`,
    ...(model === undefined ? [] : [`--model=${model}`]),
  ];
  const result = spawnSync("claude", args, {
    cwd: folders.project,
    env: claudeEnv(folders),
    encoding: "utf8",
    timeout: runBudgetMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeFileSync(join(folders.out, "transcript.jsonl"), result.stdout ?? "");
  writeFileSync(join(folders.out, "claude-stderr.txt"), result.stderr ?? "");
  if (result.error !== undefined) {
    fail(`claude did not run: ${result.error.message}`);
  }
  return result.status ?? -1;
}

function readRecord(folders: RunFolders): z.infer<typeof recordSchema> {
  let text: string;
  try {
    text = readFileSync(folders.record, "utf8");
  } catch {
    fail(`the MCP server never started; see ${join(folders.out, "claude-stderr.txt")}.`);
  }
  const record = recordSchema.parse(JSON.parse(text));
  if (record.ids.agent !== agent) {
    fail(`the engine's agent is ${record.ids.agent}; set it in this script.`);
  }
  return record;
}

const { values } = parseArgs({
  options: { model: { type: "string" }, out: { type: "string" } },
  strict: true,
});
const out = resolve(values.out ?? mkdtempSync(join(tmpdir(), "binference-skill-run-")));
const folders = foldersOf(out);
prepare(folders);
const exitCode = runClaude(folders, values.model);
const record = readRecord(folders);
const report = { prompt, model: values.model ?? "default", claudeExitCode: exitCode, ...record };
writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `skill-run: Claude Code made ${String(record.calls.length)} tool calls: ${record.calls.map((call) => call.tool).join(", ") || "none"}.`,
);
for (const problem of record.verdict.problems) {
  console.log(`skill-run: ${problem}`);
}
console.log(
  `skill-run: ${record.verdict.passed ? "passed" : "failed"}; the run's files are in ${out}.`,
);
process.exitCode = record.verdict.passed ? 0 : 1;
