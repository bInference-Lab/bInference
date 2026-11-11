import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import type {
  ChatSurface,
  ProtocolErrorCode,
  ResultOf,
  ShellAskReason,
} from "@binference/protocol";
import { chatTopic } from "../chat/chat-relay-parts.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { judgeLine, type LineJudgment } from "./allowed-match.js";
import { readCommandLine } from "./command-line.js";
import type { CommandEnd } from "./command-request.js";
import { pushClosed, type ShellContext } from "./shell-context.js";
import { leaveRunning } from "./shell-ends.js";
import { needsJudging, shellVerdict } from "./shell-policy.js";
import type { OpenShellRequest } from "./shell-requests.js";

type ShellJobView = ResultOf<"shell/run">;

/** The handlers of the agent's shell (protocol spec, section 7.11). */
export interface ShellHandlers {
  readonly "shell/run": EngineHandler<"shell/run">;
  readonly "shell/job": EngineHandler<"shell/job">;
}

// How long a call waits for a command before it answers that it still runs, by default.
const standardWaitMs = 10_000;

// How long a shell request waits for the owner's answer (decision 0378).
const requestWaitMs = 10 * 60_000;

// The surface a turn names when its runtime named none.
const defaultSurface: ChatSurface = "console";

const startRefusals: Readonly<Record<"no_wall" | "folder_missing", ProtocolErrorCode>> = {
  no_wall: "shell.no_wall",
  folder_missing: "shell.folder_missing",
};

/** One command to start: its agent, its line and folder, its time limit and any id it was given. */
export interface CommandStart {
  readonly agent: string;
  readonly command: string;
  readonly folder?: string;
  readonly timeoutMs: number;
  readonly id?: Id<"shj">;
}

/**
 * Waits until the command ends or `waitMs` passes, whichever is first; a call that stops ends the
 * wait, and the command runs on.
 */
export async function waitFor(
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

/** Starts a command as a job of its agent, its output kept from its first character. */
export function startCommand(
  context: ShellContext,
  start: CommandStart,
): Result<Id<"shj">, ProtocolErrorCode> {
  const { runner, jobs } = context;
  if (runner === undefined) {
    return err("shell.off");
  }
  // Output that comes before the job is kept waits for its id.
  const early: string[] = [];
  const job: { id?: Id<"shj"> } = {};
  const { command, timeoutMs, folder } = start;
  const started = runner.start(
    { command, timeoutMs, ...(folder === undefined ? {} : { folder }) },
    (text) => (job.id === undefined ? early.push(text) : jobs.print(job.id, text)),
  );
  if (!started.ok) {
    return err(startRefusals[started.error]);
  }
  const id = jobs.add({ agent: start.agent, command, running: started.value, ...pick(start) });
  job.id = id;
  for (const text of early.splice(0)) {
    jobs.print(id, text);
  }
  return ok(id);
}

function pick(start: CommandStart): { readonly id?: Id<"shj"> } {
  return start.id === undefined ? {} : { id: start.id };
}

/**
 * How the allowed commands judge a call's line (decision 0409): its folder's real path and the
 * judgment; `shell.folder_missing` for a folder that does not exist.
 */
export async function judgeCommand(
  context: ShellContext,
  line: { readonly command: string; readonly folder?: string },
  call: { readonly signal: AbortSignal },
): Promise<
  Result<{ readonly folder: string; readonly judgment: LineJudgment }, ProtocolErrorCode>
> {
  const { runner, store } = context;
  if (runner === undefined) {
    return err("shell.off");
  }
  const read = readCommandLine(line.command);
  const programs = read.kind === "read" ? read.steps.map((step) => step.words[0] ?? "") : [];
  const where = { programs, ...(line.folder === undefined ? {} : { folder: line.folder }) };
  const located = await runner.locate(where, call);
  if (!located.ok) {
    return err("shell.folder_missing");
  }
  const allowed = await store.allowed(call);
  const judgment = judgeLine(read, { located: located.value, dialect: runner.dialect }, allowed);
  return ok({ folder: located.value.folder, judgment });
}

// Opens a request for the call's command and pushes it; the older request of the agent closes.
function ask(
  context: ShellContext,
  call: EngineCall<"shell/run">,
  asking: {
    readonly folder: string;
    readonly judgment: LineJudgment;
    readonly reason: ShellAskReason;
  },
): ShellJobView {
  const { clock, ids, requests } = context;
  const { agent, command } = call.args;
  const now = clock.now();
  const view = {
    request: ids.next("shq"),
    agent,
    job: ids.next("shj"),
    command,
    folder: asking.folder,
    reason: asking.reason,
    canAlwaysAllow: asking.judgment.canAlwaysAllow,
    createdAt: now,
    closesAt: now + requestWaitMs,
  };
  const request: OpenShellRequest = {
    view,
    timeoutMs: timeoutOf(context, call.args),
    surface: call.args.surface ?? defaultSurface,
    steps: asking.judgment.steps,
  };
  const replaced = requests.open(request);
  if (replaced !== undefined) {
    pushClosed(context, replaced, "replaced");
  }
  context.wakeParts.publish({ topic: chatTopic(agent), kind: "chat/shellRequest", data: view });
  return askingView(request);
}

/** The view of a command that waits for the owner's answer. */
function askingView(request: OpenShellRequest): ShellJobView {
  const { job, command, folder, createdAt } = request.view;
  return {
    job,
    status: "asking",
    command,
    folder,
    startedAt: createdAt,
    timedOut: false,
    stopped: false,
    output: "",
    outputCut: false,
    request: request.view,
  };
}

function timeoutOf(context: ShellContext, args: { readonly timeoutSeconds?: number }): number {
  return (args.timeoutSeconds ?? context.settings().timeoutSeconds) * 1000;
}

// Runs the call's command and waits for it; one still running is left to tell its end.
async function run(context: ShellContext, call: EngineCall<"shell/run">) {
  const { args, signal } = call;
  const started = startCommand(context, { ...args, timeoutMs: timeoutOf(context, args) });
  if (!started.ok) {
    return started;
  }
  const id = started.value;
  const running = context.jobs.running(args.agent, id);
  const waitMs = args.background === true ? 0 : (args.waitMs ?? standardWaitMs);
  if (running !== undefined) {
    await waitFor(running.ended, { waitMs, clock: context.clock, signal });
  }
  const view = context.jobs.view(id);
  if (view.status === "running") {
    leaveRunning(context, { id, agent: args.agent, surface: args.surface ?? defaultSurface }, view);
  }
  return ok(view);
}

function runHandler(context: ShellContext): EngineHandler<"shell/run"> {
  return async (call) => {
    const settings = context.settings();
    if (settings.run === "off" || context.runner === undefined) {
      return err("shell.off");
    }
    if (!needsJudging(settings)) {
      return run(context, call);
    }
    const judged = await judgeCommand(context, call.args, call);
    if (!judged.ok) {
      return judged;
    }
    const verdict = shellVerdict(settings, judged.value.judgment);
    if (verdict.kind === "refuse") {
      return err("shell.not_listed");
    }
    if (verdict.kind === "ask") {
      return ok(ask(context, call, { ...judged.value, reason: verdict.reason }));
    }
    return run(context, call);
  };
}

// `shell/job` on a command that waits for the owner: a poll shows the request, a stop withdraws it.
function onRequest(
  context: ShellContext,
  request: OpenShellRequest,
  action: "poll" | "stop",
): ShellJobView {
  if (action === "poll") {
    return askingView(request);
  }
  const taken = context.requests.take(request.view.request);
  if (taken !== undefined) {
    pushClosed(context, taken, "withdrawn");
  }
  const { job, command, folder, createdAt } = request.view;
  return {
    job,
    status: "ended",
    command,
    folder,
    startedAt: createdAt,
    timedOut: false,
    stopped: true,
    stoppedBy: "agent",
    output: "",
    outputCut: false,
  };
}

function jobHandler(context: ShellContext): EngineHandler<"shell/job"> {
  return async ({ args, signal }) => {
    const { jobs, clock, requests } = context;
    const request = requests.ofAgent(args.agent);
    if (request?.view.job === args.job) {
      return ok(onRequest(context, request, args.action));
    }
    const running = jobs.running(args.agent, args.job);
    if (running === undefined) {
      return err("shell.job_not_found");
    }
    if (args.action === "stop") {
      jobs.stop(args.job, "agent");
    }
    const waitMs = args.waitMs ?? (args.action === "stop" ? standardWaitMs : 0);
    const release = jobs.hold(args.job);
    await waitFor(running.ended, { waitMs, clock, signal });
    release();
    return ok(jobs.view(args.job));
  };
}

/**
 * Creates `shell/run` and `shell/job` (decisions 0378 and 0409). `shell/run` judges the line
 * against the allowed commands when the settings need it: a command `shell.ask` asks about opens
 * a shell request and answers `asking`, one `shell.run: listed` does not allow is
 * `shell.not_listed`, and any other starts and waits. A command still running when the call
 * answers is left running, and its end is told to the agent.
 */
export function createShellHandlers(context: ShellContext): ShellHandlers {
  return { "shell/run": runHandler(context), "shell/job": jobHandler(context) };
}
