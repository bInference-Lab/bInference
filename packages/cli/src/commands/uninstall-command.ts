import { BinferenceError } from "@binference/core";
import type { UninstallFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { isLiveTradeAnswered, liveTradeStored } from "../state/live-trade.js";
import { type ProgramRemoval, removeProgram } from "../uninstall/remove-program.js";
import { removeState, type StateRemoval } from "../uninstall/remove-state.js";
import { removeService } from "./service-remove-command.js";
import type { ServiceRun } from "./service-start-command.js";
import { refuseLate, stopEngine, withStopRun } from "./stop-command.js";

/** What one uninstall asks for. */
interface Uninstall {
  readonly run: CommandRun;
  readonly options: UninstallFlags;
}

// The plan, the warning about the wallets with `--state`, then the phrase typed back; a wrong
// answer asks again. With `--yes` nobody is asked; with nobody to ask and no `--yes` it refuses.
async function isConfirmed(uninstall: Uninstall, folder: string): Promise<boolean> {
  const { run, options } = uninstall;
  const message = (key: string): string => run.formatter.message(`cli.${key}`, { folder });
  const phrase = message("uninstall.phrase");
  if (options.state) {
    run.output.say("uninstall.warning");
  }
  if (options.yes) {
    return true;
  }
  const { prompter } = run.host;
  if (prompter === undefined || options.json) {
    run.output.fail({
      code: "cli.needs_confirmation",
      key: "uninstall.needsYes",
      values: { phrase },
    });
    return false;
  }
  const plan = message(options.state ? "uninstall.planState" : "uninstall.plan");
  prompter.note(plan, message("uninstall.title"));
  const ask = run.formatter.message("cli.uninstall.ask", { phrase });
  await prompter.ask({
    id: "uninstallConfirm",
    message: ask,
    check: (answer) => (answer.trim() === phrase ? undefined : ask),
  });
  return true;
}

// Stops the engine and removes the service; an exit code when either did not happen.
async function stopAndRemove(run: ServiceRun): Promise<boolean | ExitCode> {
  if ((await stopEngine(run)).kind === "late") {
    return refuseLate(run);
  }
  try {
    return await removeService(run);
  } catch (error) {
    const code = error instanceof BinferenceError ? error.code : "unexpected";
    run.output.fail({ code, key: "uninstall.serviceFailed", values: { code } });
    return 1;
  }
}

// Removes the state folder once no live trade is on its way; an exit code when it stays.
async function removeStateOf(
  run: ServiceRun,
): Promise<Extract<StateRemoval, { readonly kind: "removed" }> | ExitCode> {
  if ((await liveTradeStored(run.host, run.signal)) === "sending") {
    run.output.fail({ code: "intent.executing", key: "uninstall.tradeSendingStopped" });
    return 1;
  }
  const removal = await removeState(run.host, run.signal);
  if (removal.kind === "not_state") {
    const values = { folder: removal.folder };
    run.output.fail({ code: "cli.not_state_folder", key: "uninstall.notStateFolder", values });
    return 1;
  }
  return removal;
}

function sayProgram(uninstall: Uninstall, removal: ProgramRemoval): ExitCode {
  const { output } = uninstall.run;
  switch (removal.kind) {
    case "removed":
      output.say("uninstall.programRemoved");
      break;
    case "by_hand":
      output.say("uninstall.programByHand", { command: removal.command });
      break;
    case "failed":
      output.say("uninstall.programFailed", { command: removal.command });
      break;
    case "not_npm":
      output.say("uninstall.programNotNpm", { folder: removal.folder });
      break;
  }
  return removal.kind === "failed" ? 1 : 0;
}

async function uninstallWith(uninstall: Uninstall, run: ServiceRun): Promise<ExitCode> {
  const removed = await stopAndRemove(run);
  if (typeof removed === "number") {
    return removed;
  }
  const { output } = uninstall.run;
  const folder = run.platform.stateFolder.root;
  output.say(removed ? "uninstall.serviceRemoved" : "uninstall.serviceNone");
  const state = uninstall.options.state ? await removeStateOf(run) : undefined;
  if (typeof state === "number") {
    return state;
  }
  const keychain = state?.keychain ?? [];
  const names = keychain.join(", ");
  output.say(state === undefined ? "uninstall.stateKept" : "uninstall.stateRemoved", {
    folder,
    count: keychain.length,
    names,
  });
  const program = await removeProgram(run.host, run.signal);
  output.json({
    service: removed ? "removed" : "none",
    state: state === undefined ? "kept" : "removed",
    keychain: [...keychain],
    program: program.kind,
  });
  return sayProgram(uninstall, program);
}

/**
 * `binference uninstall [--state]` (decision 0264): stops the engine as `binference stop` does,
 * removes the background service as `binference service remove` does, then removes the program,
 * which npm installed. With `--state` it also removes the state folder and the keychain entries
 * of the install, after a warning in the owner's language that the wallets stay in Privy and only
 * the owner key, which is not in the state folder, or a rescue moves their funds. At a terminal it
 * asks the owner to type a phrase; with nobody there it goes on only with `--yes`. It refuses while
 * a live trade is being sent, and a step that fails stops every step after it. With `--json` it
 * prints `{ service, state, keychain, program }`. Exits 0 when everything asked is done or left
 * for the owner to finish, 1 otherwise.
 */
export async function runUninstall(
  run: CommandRun,
  request: { readonly options: UninstallFlags },
): Promise<ExitCode> {
  const uninstall = { run, options: request.options };
  return withStopRun(run.host, run.output, async (stopping) => {
    if (request.options.state && (await isLiveTradeAnswered(run.host, stopping.signal))) {
      run.output.fail({ code: "intent.executing", key: "uninstall.tradeSending" });
      return 1;
    }
    if (!(await isConfirmed(uninstall, stopping.platform.stateFolder.root))) {
      return 1;
    }
    return uninstallWith(uninstall, stopping);
  });
}
