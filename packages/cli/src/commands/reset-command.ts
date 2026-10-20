import { createDeadline } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { StartFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { systemDefaults } from "../program/system-defaults.js";
import { clearLocalState, type ResetOutcome } from "../reset/clear-local-state.js";
import { isLiveTradeAnswered } from "../state/live-trade.js";
import { type EngineRun, startAs, stopFor } from "./engine-runs.js";

// The backup reads and seals both databases; on a large install that takes a while.
const resetBudgetMs = 10 * 60_000;
// A running engine answers whether a live trade is on its way within moments.
const askBudgetMs = 15_000;

/** What one reset asks for: its command run and its options. */
interface Reset {
  readonly run: CommandRun;
  readonly options: StartFlags;
}

async function configOf(reset: Reset): Promise<BinferenceConfig | undefined> {
  const { host, output } = reset.run;
  const platform = platformOf(host);
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: reset.options.sets,
    system: systemDefaults(host.env, platform),
    signal: new AbortController().signal,
  });
  if (!loaded.ok) {
    output.fail({ code: "config.invalid", key: "reset.configInvalid" });
    return undefined;
  }
  return loaded.config;
}

// The plan, then the phrase typed back; a wrong answer asks again. With `--yes` nobody is asked;
// with nobody to ask and no `--yes` it refuses.
async function isConfirmed(reset: Reset): Promise<boolean> {
  const { run, options } = reset;
  const phrase = run.formatter.message("cli.reset.phrase");
  if (options.yes) {
    return true;
  }
  const { prompter } = run.host;
  if (prompter === undefined || options.json) {
    run.output.fail({ code: "cli.needs_confirmation", key: "reset.needsYes", values: { phrase } });
    return false;
  }
  prompter.note(run.formatter.message("cli.reset.plan"), run.formatter.message("cli.reset.title"));
  const ask = run.formatter.message("cli.reset.ask", { phrase });
  await prompter.ask({
    id: "resetConfirm",
    message: ask,
    check: (answer) => (answer.trim() === phrase ? undefined : ask),
  });
  return true;
}

// Why a reset changed nothing: the code scripts read and the words a person reads.
const refusals: {
  readonly [K in Exclude<ResetOutcome["kind"], "reset">]: {
    readonly code: string;
    readonly key: string;
  };
} = {
  backup_failed: { code: "backup.failed", key: "reset.backupFailed" },
  sending: { code: "intent.executing", key: "reset.tradeSending" },
  locked: { code: "engine.already_running", key: "reset.locked" },
  unreadable: { code: "store.unreadable", key: "reset.unreadable" },
};

// Says how the reset ended; answers its exit code before the engine starts again.
function report(reset: Reset, outcome: ResetOutcome): ExitCode {
  const { output } = reset.run;
  if (outcome.kind === "reset") {
    const { backup, cleared } = outcome;
    output.json({ backup: { id: backup.id, file: backup.path }, cleared: { ...cleared } });
    output.say("reset.done", { backup: backup.id, file: backup.path, ...cleared });
    return 0;
  }
  const folder = platformOf(reset.run.host).stateFolder.root;
  const failure = outcome.kind === "backup_failed" ? outcome.failure : "";
  output.fail({ ...refusals[outcome.kind], values: { folder, failure } });
  return 1;
}

// Clears the local state with the engine stopped, then starts it again as it ran.
async function resetStopped(
  reset: Reset,
  config: BinferenceConfig,
  ran: EngineRun,
): Promise<ExitCode> {
  const { run, options } = reset;
  const deadline = createDeadline({
    clock: run.host.clock,
    signal: new AbortController().signal,
    timeoutMs: resetBudgetMs,
  });
  const outcome = await clearLocalState({
    host: run.host,
    config,
    signal: deadline.signal,
  }).finally(() => deadline.clear());
  const code = report(reset, outcome);
  if (ran === "stopped") {
    return code;
  }
  const started = await startAs(run, options.sets, ran);
  if (!started.isStarted) {
    return started.code;
  }
  const served = await started.serve();
  return code === 0 ? served : code;
}

/**
 * `binference reset` (decision 0265): clears the local state an owner may want gone, after a
 * backup sealed to the owner key: every agent's chats and notes, unread messages for the agent,
 * open questions and the token risk cache. Wallets, the custody link, the keys, the config, limits,
 * saved addresses, orders, schedules, workspace files and every money record stay, so the wallets
 * read as before. It refuses while a live trade is on its way. At a terminal the owner types a
 * phrase first; with nobody there it goes on only with `--yes`. It stops the engine as
 * `binference stop` does, clears under the engine lock, records the reset in the config journal,
 * and starts the engine again as it ran, with this run's `--set` flags. With `--json` it prints
 * the backup and what was cleared. Exits 0 once reset, 1 when it refused.
 */
export async function runReset(
  run: CommandRun,
  request: { readonly options: StartFlags },
): Promise<ExitCode> {
  const reset = { run, options: request.options };
  const config = await configOf(reset);
  if (config === undefined) {
    return 1;
  }
  const asking = createDeadline({
    clock: run.host.clock,
    signal: new AbortController().signal,
    timeoutMs: askBudgetMs,
  });
  const isSending = await isLiveTradeAnswered(run.host, asking.signal).finally(() => {
    asking.clear();
  });
  if (isSending) {
    run.output.fail({ code: "intent.executing", key: "reset.tradeSending" });
    return 1;
  }
  if (!(await isConfirmed(reset))) {
    return 1;
  }
  const ran = await stopFor(run);
  if (ran === undefined) {
    const folder = platformOf(run.host).stateFolder.root;
    run.output.fail({ code: "engine.still_running", key: "stop.late", values: { folder } });
    return 1;
  }
  return resetStopped(reset, config, ran);
}
