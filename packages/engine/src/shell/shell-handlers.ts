import { type Clock, err, type Id, ok } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import type { CommandEnd } from "./command-request.js";
import type { CommandRunner } from "./ports.js";
import type { ShellJobs } from "./shell-jobs.js";

/** The owner's shell settings, read at each call: whether it runs, and a command's time limit. */
export interface ShellSettings {
  readonly run: "off" | "any";
  /** A command's time limit when the call names none; 0 for no limit. */
  readonly timeoutSeconds: number;
}

/** The handlers of the agent's shell (protocol spec, section 7.11). */
export interface ShellHandlers {
  readonly "shell/run": EngineHandler<"shell/run">;
  readonly "shell/job": EngineHandler<"shell/job">;
}

/** What the shell handlers run commands through, keep them in, and time their waits with. */
export interface ShellHandlersOptions {
  /** The runner, when this machine has one; without it the shell is off. */
  readonly runner?: CommandRunner;
  readonly settings: () => ShellSettings;
  readonly jobs: ShellJobs;
  readonly clock: Clock;
}

// How long a call waits for a command before it answers that it still runs, by default.
const standardWaitMs = 10_000;

const startRefusals: Readonly<Record<"no_wall" | "folder_missing", ProtocolErrorCode>> = {
  no_wall: "shell.no_wall",
  folder_missing: "shell.folder_missing",
};

// Waits until the command ends or `waitMs` passes, whichever is first; a call that stops ends the
// wait, and the command runs on.
async function waitFor(
  ended: Promise<CommandEnd>,
  call: { readonly waitMs: number; readonly clock: Clock; readonly signal: AbortSignal },
): Promise<void> {
  if (call.waitMs <= 0) {
    return;
  }
  const done = new AbortController();
  const stop = (): void => {
    done.abort();
  };
  call.signal.addEventListener("abort", stop, { once: true });
  const slept = call.clock.sleep(call.waitMs, done.signal).catch(() => undefined);
  await Promise.race([
    ended.then(
      () => undefined,
      () => undefined,
    ),
    slept,
  ]);
  done.abort();
  call.signal.removeEventListener("abort", stop);
}

function runHandler(options: ShellHandlersOptions): EngineHandler<"shell/run"> {
  return async ({ args, signal }) => {
    const settings = options.settings();
    const { runner, jobs, clock } = options;
    if (settings.run === "off" || runner === undefined) {
      return err("shell.off");
    }
    const timeoutMs = (args.timeoutSeconds ?? settings.timeoutSeconds) * 1000;
    // Output that comes before the job is kept waits for its id.
    const early: string[] = [];
    const job: { id?: Id<"shj"> } = {};
    const started = runner.start(
      {
        command: args.command,
        timeoutMs,
        ...(args.folder === undefined ? {} : { folder: args.folder }),
      },
      (text) => (job.id === undefined ? early.push(text) : jobs.print(job.id, text)),
    );
    if (!started.ok) {
      return err(startRefusals[started.error]);
    }
    const id = jobs.add({ agent: args.agent, command: args.command, running: started.value });
    job.id = id;
    for (const text of early.splice(0)) {
      jobs.print(id, text);
    }
    const waitMs = args.background === true ? 0 : (args.waitMs ?? standardWaitMs);
    await waitFor(started.value.ended, { waitMs, clock, signal });
    return ok(jobs.view(id));
  };
}

function jobHandler(options: ShellHandlersOptions): EngineHandler<"shell/job"> {
  return async ({ args, signal }) => {
    const { jobs, clock } = options;
    const running = jobs.running(args.agent, args.job);
    if (running === undefined) {
      return err("shell.job_not_found");
    }
    if (args.action === "stop") {
      running.stop();
    }
    const waitMs = args.waitMs ?? (args.action === "stop" ? standardWaitMs : 0);
    await waitFor(running.ended, { waitMs, clock, signal });
    return ok(jobs.view(args.job));
  };
}

/** Creates the handlers of `shell/run` and `shell/job` (decision 0378). */
export function createShellHandlers(options: ShellHandlersOptions): ShellHandlers {
  return { "shell/run": runHandler(options), "shell/job": jobHandler(options) };
}
