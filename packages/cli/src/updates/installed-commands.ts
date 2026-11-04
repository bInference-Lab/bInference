import { type ProgramExit, runCommandWithin } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

// A start installs the service and waits for the engine's answer; a check with --fix may take a
// sealed backup first. Past these the installed program did not answer.
const startBudgetMs = 3 * 60_000;
const fixBudgetMs = 3 * 60_000;

/**
 * Runs a command of the installed program as a program of its own (decision 0356): the version
 * npm put in place, with this process's Node and Node options. The process that runs `update`
 * loads none of the files npm changed.
 */
export async function runInstalled(
  host: CliHost,
  command: { readonly args: readonly string[]; readonly budgetMs: number },
  signal: AbortSignal,
): Promise<ProgramExit> {
  const run = host.runProgram ?? runCommandWithin;
  const { node, nodeOptions, script } = host.entry;
  return run(node, [...nodeOptions, script, ...command.args], {
    signal,
    timeoutMs: command.budgetMs,
  });
}

/**
 * Starts the engine through the installed program's own `binference start`, which installs the
 * background service with the `--set` flags given and waits for the engine's answer; answers
 * whether it started. Never an engine inside this process.
 */
export async function startInstalled(
  host: CliHost,
  sets: readonly string[],
  signal: AbortSignal,
): Promise<boolean> {
  const args = ["start", "--json", ...sets.flatMap((set) => ["--set", set])];
  try {
    return (await runInstalled(host, { args, budgetMs: startBudgetMs }, signal)).exitCode === 0;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

/**
 * Runs the installed program's own `binference check --fix` on the stopped state, which moves an
 * older `config.json5` to its version after a sealed backup, as its engine needs before it starts.
 * What it finds is not the verdict: the check after the start is.
 */
export async function fixInstalledConfig(host: CliHost, signal: AbortSignal): Promise<void> {
  const args = ["check", "--fix", "--json"];
  try {
    await runInstalled(host, { args, budgetMs: fixBudgetMs }, signal);
  } catch {
    signal.throwIfAborted();
  }
}
