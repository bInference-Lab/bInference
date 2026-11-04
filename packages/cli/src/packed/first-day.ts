import { join } from "node:path";
import process from "node:process";
import { createMemorySecretStore } from "@binference/core/testing";
import {
  readTextFile,
  realFilePath,
  runCommandWithin,
  writeReadableFile,
} from "@binference/platform";
import { z } from "zod";
import { engineServiceName } from "../compose/engine-service.js";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";
import {
  guardProblems,
  installProblems,
  leftoversOf,
  pairingCodeOf,
  runSteps,
  type StepResult,
  type StepRun,
  sameCodeProblems,
  statusProblems,
  uninstallProblems,
  updateVerdict,
} from "./first-day-checks.js";
import { openFirstDayPrivy } from "./first-day-privy.js";
import { type FirstDayWorld, openFirstDay, runLauncher } from "./first-day-world.js";
import type { SmokeBot } from "./smoke-bot.js";
import { chatAgain, lastJsonLine, pairOwner, paperTradeScript, tradeByChat } from "./smoke-chat.js";
import { smokeHostOf } from "./smoke-host.js";
import { startPaperPortfolio } from "./smoke-paper-start.js";

// The first-day smoke's driver, which `pnpm first-day:smoke` runs once the install one-liner put
// release A in place in a scratch home folder (decision 0359). It goes on through the owner's
// first day on that install, each step timed: `init --yes` with its answers in `BINFERENCE_INIT_*`
// variables, `start` as the background service, a paper trade by chat on the synthetic Bot API
// with a scripted model, `status` with every part of the engine in place, `update` to release B
// with the engine ready on B and the chat still answering, and `uninstall --state`, after which
// nothing of binference stays in the home folder. `init`, `status` and `--version` run through
// the launcher; `start`, `update` and `uninstall` run from the repository's sources on child
// services, so none reaches the OS's service manager, and stand-ins on PATH log any call of its
// tools. Like `src/main.ts`, it reads `process`. It writes the steps to the report file it is
// given.

const minute = 60_000;
const oneLinerSchema = z.object({
  status: z.number(),
  output: z.string(),
  command: z.string().exactOptional(),
  seconds: z.number(),
  sources: z.object({ commit: z.string(), isChanged: z.boolean() }),
});

// The one-liner's own verdict, then whether the launcher runs release A and the sources are the
// code A and B were packed from, since `start`, `update` and `uninstall` run from the sources.
async function checkInstall(
  world: FirstDayWorld,
  installed: z.infer<typeof oneLinerSchema>,
): Promise<readonly string[]> {
  const problems = installProblems(installed, world.paths);
  if (problems.length > 0) {
    return problems;
  }
  const printed = await runLauncher(world, ["--version"]);
  const launcher = { printed: printed.stdout, version: world.versions.from };
  return sameCodeProblems(world.packedCommit, installed.sources, launcher);
}

// Runs a command line of the sources, as `version`, and answers its exit code and its words.
async function runSource(world: FirstDayWorld, argv: readonly string[], version: string) {
  const said: string[] = [];
  const out = (text: string) => {
    said.push(text);
    process.stdout.write(text);
  };
  const host: CliHost = {
    ...smokeHostOf(world, argv, version),
    out,
    keychain: createMemorySecretStore({}),
  };
  return { code: await runCli(host), said: said.join("") };
}

// `init --yes` through the launcher, with its answers in variables: the pairing code it printed.
async function setUp(world: FirstDayWorld): Promise<string | readonly string[]> {
  const init = await runLauncher(world, ["init", "--yes", "--json"], world.initAnswers);
  process.stdout.write(`${init.stdout.trimEnd()}\n`);
  const code = pairingCodeOf(init.exitCode, lastJsonLine(init.stdout));
  return typeof code === "string"
    ? code
    : [...code, init.stderr.trim()].filter((line) => line !== "");
}

function polls(api: SmokeBot["api"]): boolean {
  return api.calls().some((call) => call.method === "getUpdates");
}

async function startService(world: FirstDayWorld, version: string): Promise<readonly string[]> {
  const started = await runSource(world, ["start", "--json"], version);
  if (started.code !== 0) {
    return [`start ended with ${String(started.code)}`];
  }
  await world.bot.until("poll for updates", polls, minute);
  return [];
}

async function trade(world: FirstDayWorld, code: string): Promise<readonly string[]> {
  await pairOwner(world.bot, code);
  await startPaperPortfolio(world.paths.state, AbortSignal.timeout(minute));
  await tradeByChat(world.bot, paperTradeScript.report);
  return [];
}

async function status(world: FirstDayWorld, version: string): Promise<readonly string[]> {
  const shown = await runLauncher(world, ["status", "--json"]);
  return statusProblems(lastJsonLine(shown.stdout), version);
}

// `update --to` B, from `version`: its verdict, which is a refusal on Windows.
async function updateTo(
  world: FirstDayWorld,
  version: string,
): Promise<readonly string[] | "refused"> {
  const argv = ["update", "--to", world.versions.to, "--json"];
  const ran = await runSource(world, argv, version);
  return updateVerdict(world.os, ran.code, ran.said);
}

// Once B is in place, it must be ready with every part and the chat must still answer.
async function afterUpdate(world: FirstDayWorld): Promise<readonly string[]> {
  const problems = await status(world, world.versions.to);
  if (problems.length > 0) {
    return problems;
  }
  await chatAgain(world.bot, paperTradeScript.report, 3);
  return [];
}

// The command uninstall printed for the owner on Windows, which the owner runs next.
async function runByHand(said: string): Promise<readonly string[]> {
  const command = /once this command ends: (.+)$/m.exec(said)?.[1];
  if (command === undefined) {
    return ["uninstall printed no command to remove binference with"];
  }
  const shell = ["-NoProfile", "-NonInteractive", "-Command", command];
  const ran = await runCommandWithin("powershell.exe", shell, {
    signal: AbortSignal.timeout(minute),
    timeoutMs: minute,
  });
  return ran.exitCode === 0 ? [] : [`the printed command ended with ${String(ran.exitCode)}`];
}

async function exists(path: string): Promise<boolean> {
  return realFilePath(path, AbortSignal.timeout(minute)).then(
    () => true,
    () => false,
  );
}

async function uninstall(world: FirstDayWorld, version: string): Promise<readonly string[]> {
  const ran = await runSource(world, ["uninstall", "--state", "--yes"], version);
  const problems = uninstallProblems(ran.code, ran.said, world.paths);
  const byHand = world.os === "win32" ? await runByHand(ran.said) : [];
  const service = await world.services.status(engineServiceName, AbortSignal.timeout(minute));
  const serviceInstalled = service.state !== "not_installed";
  const left = await leftoversOf(world.paths, { exists, serviceInstalled });
  return [...problems, ...byHand, ...left];
}

// The step's own problems, then any call of the OS's service tools the stand-ins logged.
function guarded(world: FirstDayWorld, step: StepRun): StepRun {
  return {
    step: step.step,
    run: async () => {
      const ran = await step.run();
      const log = await readTextFile(world.guardLog, AbortSignal.timeout(minute));
      const calls = guardProblems(log.ok ? log.value : "");
      if (calls.length === 0) {
        return ran;
      }
      return [...(ran === "refused" ? [] : ran), ...calls];
    },
  };
}

function stepsOf(world: FirstDayWorld, installed: z.infer<typeof oneLinerSchema>): StepRun[] {
  let code = "";
  let version = world.versions.from;
  const steps: StepRun[] = [
    { step: "install", run: async () => checkInstall(world, installed) },
    {
      step: "init",
      run: async () => {
        const set = await setUp(world);
        code = typeof set === "string" ? set : "";
        return typeof set === "string" ? [] : set;
      },
    },
    { step: "start", run: async () => startService(world, version) },
    { step: "trade", run: async () => trade(world, code) },
    { step: "status", run: async () => status(world, version) },
    {
      step: "update",
      run: async () => {
        const verdict = await updateTo(world, version);
        if (verdict === "refused" || verdict.length > 0) {
          return verdict;
        }
        version = world.versions.to;
        return afterUpdate(world);
      },
    },
    { step: "uninstall", run: async () => uninstall(world, version) },
  ];
  return steps.map((step) => guarded(world, step));
}

async function logTail(world: FirstDayWorld): Promise<string> {
  const log = join(world.paths.state, "logs", "engine.log");
  const read = await readTextFile(log, AbortSignal.timeout(5_000));
  return read.ok ? read.value.split("\n").slice(-60).join("\n") : "No engine log.";
}

// The one-liner ran before this process; its time joins the install step's own check.
function withInstallTime(results: readonly StepResult[], seconds: number): StepResult[] {
  const joined: StepResult[] = [];
  for (const result of results) {
    const total = Math.round((result.seconds + seconds) * 10) / 10;
    joined.push(result.step === "install" ? { ...result, seconds: total } : result);
  }
  return joined;
}

// On Privy's dev app, the cleanup of what the day made there, timed as a step of its own; it runs
// even when a step failed, once the engine has stopped.
async function cleanUp(world: FirstDayWorld): Promise<readonly StepResult[]> {
  if (world.privy.kind === "fake") {
    return [];
  }
  const run = async () => world.privy.cleanUp(AbortSignal.timeout(10 * minute));
  return runSteps([{ step: "cleanup", run }], () => performance.now());
}

const [packed, scratch, guard, reportFile, mode] = process.argv.slice(2);
if (packed === undefined || scratch === undefined || guard === undefined || !reportFile) {
  process.stderr.write(
    "Usage: first-day.ts <packed folder> <scratch> <guard> <report file> [fake|real]\n",
  );
  process.exit(1);
}
const oneLinerRead = await readTextFile(
  join(scratch, "one-liner.json"),
  AbortSignal.timeout(5_000),
);
const installed = oneLinerSchema.parse(JSON.parse(oneLinerRead.ok ? oneLinerRead.value : "null"));
const privy = await openFirstDayPrivy(
  mode === "real" ? "real" : "fake",
  AbortSignal.timeout(minute),
);
const world = await openFirstDay({ packed, scratch, guard }, privy);
const results: StepResult[] = [];
try {
  const ran = await runSteps(stepsOf(world, installed), () => performance.now());
  results.push(...withInstallTime(ran, installed.seconds));
  if (results.some((result) => result.outcome === "failed")) {
    process.stderr.write(`--- engine.log\n${await logTail(world)}\n`);
  }
} finally {
  await world.services.uninstall(engineServiceName, AbortSignal.timeout(minute));
  await world.close();
  results.push(...(await cleanUp(world)));
}
const report = { privy: privy.kind, versions: world.versions, steps: results };
const text = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
await writeReadableFile(reportFile, text, AbortSignal.timeout(5_000));
const dayRan = results.filter((result) => result.step !== "cleanup").length === 7;
process.exitCode = dayRan && results.every((result) => result.outcome !== "failed") ? 0 : 1;
