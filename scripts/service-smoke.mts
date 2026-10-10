import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { currentConfigVersion } from "binference";
import { z } from "zod";
import { type CommandResult, runCommand } from "./run-command.mjs";

// The background service's smoke test on a CI runner, in phases with the OS's own logout and login
// between them, which the workflow runs:
//
//   start    writes a config.json5 and runs `binference start`, which installs the service
//   answers  waits until the engine the OS started answers `binference status`
//   stop     runs `binference stop`, which stops the engine and keeps the service
//
// It changes the runner's login items, so only CI runs it. binference runs from source with the
// TypeScript loader named by its full path, since the service starts in the state folder, where
// no node_modules is.

const root = fileURLToPath(new URL("..", import.meta.url));
const main = join(root, "packages", "cli", "src", "main.ts");
const loader = import.meta.resolve("tsx");
const stateFolder = join(homedir(), ".binference");
const logs = join(stateFolder, "logs");
// The engine's own start budget is 60 s; the OS takes a few more to run it after a login.
const answerBudgetMs = 90_000;

const startedSchema = z.object({
  service: z.literal("running"),
  state: z.enum(["ready", "locked", "starting"]),
  logFile: z.string(),
  serviceLog: z.string(),
});
const statusSchema = z.object({ state: z.enum(["ready", "locked", "starting"]) });
const stoppedSchema = z.object({ state: z.literal("stopped"), service: z.literal("stopped") });

function binference(args: readonly string[]): CommandResult {
  const node = ["node", "--conditions=@binference/source", "--import", loader, main];
  return runCommand([...node, ...args, "--json"], { cwd: root, env: { LANG: "en_US.UTF-8" } });
}

// The last line of a command's output that is JSON, which `--json` prints last.
function lastJson(result: CommandResult): unknown {
  const lines = result.output.split("\n").filter((line) => line.startsWith("{"));
  return JSON.parse(lines.at(-1) ?? "null");
}

function fail(message: string, result?: CommandResult): never {
  console.error(`service-smoke: ${message}`);
  if (result !== undefined) {
    console.error(result.output);
  }
  for (const file of ["service.log", "engine.log"]) {
    try {
      console.error(`--- ${file}\n${readFileSync(join(logs, file), "utf8").slice(-8_000)}`);
    } catch {
      console.error(`--- ${file}: none`);
    }
  }
  process.exit(1);
}

// A state folder with the smallest config the engine starts on. The bot token comes from a
// variable the service never sees, so the engine starts without the bot and calls no Telegram.
function writeConfig(): void {
  mkdirSync(stateFolder, { recursive: true, mode: 0o700 });
  const text = [
    "{",
    `  version: ${String(currentConfigVersion)},`,
    '  telegram: { botToken: { fromEnv: "SMOKE_BOT_TOKEN" } },',
    "}",
    "",
  ].join("\n");
  writeFileSync(join(stateFolder, "config.json5"), text, { mode: 0o600 });
}

function start(): void {
  writeConfig();
  const started = binference(["start"]);
  const parsed = startedSchema.safeParse(lastJson(started));
  if (started.status !== 0 || !parsed.success) {
    fail("binference start did not run the engine as a background service.", started);
  }
  console.log(`service-smoke: the service runs; the engine is ${parsed.data.state}.`);
  console.log(`service-smoke: logs at ${parsed.data.logFile} and ${parsed.data.serviceLog}.`);
}

// Asks `binference status` once a second until the engine answers past `starting`, or time is up.
async function waitForAnswer(until: number): Promise<CommandResult> {
  const last = binference(["status"]);
  const status = statusSchema.safeParse(lastJson(last));
  if ((last.status === 0 && status.data?.state !== "starting") || Date.now() >= until) {
    return last;
  }
  await delay(1_000);
  return waitForAnswer(until);
}

async function answers(): Promise<void> {
  const last = await waitForAnswer(Date.now() + answerBudgetMs);
  const status = statusSchema.safeParse(lastJson(last));
  if (last.status !== 0 || !status.success || status.data.state === "starting") {
    fail("the engine the OS started did not answer.", last);
  }
  console.log(`service-smoke: the engine the OS started answers; it is ${status.data.state}.`);
}

function stop(): void {
  const stopped = binference(["stop"]);
  if (stopped.status !== 0 || !stoppedSchema.safeParse(lastJson(stopped)).success) {
    fail("binference stop did not stop the engine and keep the service.", stopped);
  }
  if (binference(["status"]).status === 0) {
    fail("the engine still answers after binference stop.");
  }
  console.log("service-smoke: the engine stopped, and the service waits for the next login.");
}

const phase = process.argv[2];
if (phase === "start") {
  start();
} else if (phase === "answers") {
  await answers();
} else if (phase === "stop") {
  stop();
} else {
  fail("name a phase: start, answers or stop.");
}
