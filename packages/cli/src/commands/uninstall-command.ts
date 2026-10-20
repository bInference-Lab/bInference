import { BinferenceError } from "@binference/core";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { type ProgramRemoval, removeProgram } from "../uninstall/remove-program.js";
import { removeService } from "./service-remove-command.js";
import type { ServiceRun } from "./service-start-command.js";
import { refuseLate, stopEngine, withStopRun } from "./stop-command.js";

/** What one uninstall asks for. */
interface Uninstall {
  readonly run: CommandRun;
  readonly options: CommonOptions;
}

// The plan, then the phrase typed back; a wrong
// answer asks again. With `--yes` nobody is asked; with nobody to ask and no `--yes` it refuses.
async function isConfirmed(uninstall: Uninstall, folder: string): Promise<boolean> {
  const { run, options } = uninstall;
  const message = (key: string): string => run.formatter.message(`cli.${key}`, { folder });
  const phrase = message("uninstall.phrase");
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
  prompter.note(message("uninstall.plan"), message("uninstall.title"));
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
  output.say("uninstall.stateKept", { folder });
  const program = await removeProgram(run.host, run.signal);
  output.json({
    service: removed ? "removed" : "none",
    state: "kept",
    keychain: [],
    program: program.kind,
  });
  return sayProgram(uninstall, program);
}

/**
 * `binference uninstall` (decision 0264): stops the engine as `binference stop` does, removes the
 * background service as `binference service remove` does, then removes the program, which npm
 * installed. The state folder stays. At a terminal it asks the owner to type a phrase; with nobody
 * there it goes on only with `--yes`. A step that fails stops every step after it. With `--json`
 * it prints `{ service, state, keychain, program }`. Exits 0 when everything is done or left for
 * the owner to finish, 1 otherwise.
 */
export async function runUninstall(
  run: CommandRun,
  request: { readonly options: CommonOptions },
): Promise<ExitCode> {
  const uninstall = { run, options: request.options };
  return withStopRun(run.host, run.output, async (stopping) => {
    if (!(await isConfirmed(uninstall, stopping.platform.stateFolder.root))) {
      return 1;
    }
    return uninstallWith(uninstall, stopping);
  });
}
