import { BinferenceError } from "@binference/core";
import type { UninstallFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { isLiveTradeAnswered, liveTradeStored } from "../state/live-trade.js";
import { type ProgramRemoval, removeProgram } from "../uninstall/remove-program.js";
import { type AgentKeyLeft, removeState, type StateRemoval } from "../uninstall/remove-state.js";
import { removeService } from "./service-remove-command.js";
import type { ServiceRun } from "./service-start-command.js";
import { refuseLate, stopEngine, withStopRun } from "./stop-command.js";
import { isTypedConfirmed } from "./typed-confirmation.js";

/** A state folder removal that happened. */
type RemovedState = Extract<StateRemoval, { readonly kind: "removed" }>;

/** What one uninstall asks for. */
interface Uninstall {
  readonly run: CommandRun;
  readonly options: UninstallFlags;
}

// The warning about the wallets with `--state`, then the plan and the phrase typed back.
async function isConfirmed(uninstall: Uninstall, folder: string): Promise<boolean> {
  const { run, options } = uninstall;
  if (options.state) {
    run.output.say("uninstall.warning");
  }
  const planKey = options.state ? "uninstall.planState" : "uninstall.plan";
  return isTypedConfirmed(run, options, { area: "uninstall", planKey, values: { folder } });
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
async function removeStateOf(run: ServiceRun): Promise<RemovedState | ExitCode> {
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

// Says where the agent key is once the state folder is gone; never a secret or a command's arguments.
function sayAgentKey(uninstall: Uninstall, left: AgentKeyLeft): void {
  const { output } = uninstall.run;
  switch (left.kind) {
    case "in_folder":
      output.say("uninstall.agentKeyFolder");
      break;
    case "keychain_removed":
      output.say("uninstall.agentKeyKeychainRemoved");
      break;
    case "keychain_left":
      output.say("uninstall.agentKeyKeychainLeft");
      break;
    case "unknown":
      output.say("uninstall.agentKeyUnknown");
      break;
    case "command":
      output.say("uninstall.agentKeyCommand", { program: left.program });
      break;
  }
}

// Says whether the state folder stays, or what went with it and where the agent key is now.
function sayState(uninstall: Uninstall, folder: string, state: RemovedState | undefined): void {
  const { output } = uninstall.run;
  if (state === undefined) {
    output.say("uninstall.stateKept", { folder });
    return;
  }
  const { keychain } = state;
  output.say("uninstall.stateRemoved", {
    folder,
    count: keychain.length,
    names: keychain.join(", "),
  });
  sayAgentKey(uninstall, state.agentKey);
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
  sayState(uninstall, folder, state);
  const program = await removeProgram(run.host, run.signal);
  output.json({
    service: removed ? "removed" : "none",
    state: state === undefined ? "kept" : "removed",
    keychain: [...(state?.keychain ?? [])],
    agentKey: state === undefined ? "kept" : state.agentKey.kind,
    program: program.kind,
  });
  return sayProgram(uninstall, program);
}

/**
 * `binference uninstall [--state]` (decision 0264): stops the engine as `binference stop` does,
 * removes the background service as `binference service remove` does, then removes the program,
 * which npm installed. With `--state` it also removes the state folder and the keychain entries
 * of the install, and says where the agent key stays, after a warning in the owner's language
 * that the wallets stay in Privy and only
 * the owner key, which is not in the state folder, or a rescue moves their funds. At a terminal it
 * asks the owner to type a phrase; with nobody there it goes on only with `--yes`. It refuses while
 * a live trade is being sent, and a step that fails stops every step after it. With `--json` it
 * prints `{ service, state, keychain, agentKey, program }`. Exits 0 when everything asked is done or left
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
