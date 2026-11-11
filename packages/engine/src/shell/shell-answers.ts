import { err, idSchema, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ShellRequestOutcome } from "@binference/protocol";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCaller, EngineHandler } from "../operations/engine-call.js";
import { keepAllowed } from "./allowed-handlers.js";
import { pushClosed, type ShellContext } from "./shell-context.js";
import { leaveRunning, wakeAgent } from "./shell-ends.js";
import { judgeCommand, startCommand, waitFor } from "./shell-handlers.js";
import { runsUnanswered } from "./shell-policy.js";
import type { OpenShellRequest } from "./shell-requests.js";
import { ranText, refusedText } from "./shell-words.js";

/** The handlers of the owner's answers to shell requests (protocol spec, section 7.11). */
export interface ShellAnswerHandlers {
  readonly "shell/answer": EngineHandler<"shell/answer">;
  readonly "shell/requests": EngineHandler<"shell/requests">;
}

// How long an answered command may run before the agent hears it runs on as a job.
const firstWaitMs = 10_000;

// The engine's own work after an answer, which a stop of the engine ends with the process.
const ownWork = { signal: new AbortController().signal };

type RanOutcome = "allowed_once" | "allowed_always" | "ran_unanswered";

// Waits up to 10 seconds for a command that ran on the owner's answer, then wakes the agent with
// its end and output, or with the job it runs as, which then tells its own end.
async function follow(context: ShellContext, request: OpenShellRequest, outcome: RanOutcome) {
  const { agent, job } = request.view;
  const running = context.jobs.running(agent, job);
  if (running !== undefined) {
    await waitFor(running.ended, { waitMs: firstWaitMs, clock: context.clock, ...ownWork });
  }
  const view = context.jobs.view(job);
  if (view.status === "running") {
    leaveRunning(context, { id: job, agent, surface: request.surface }, view);
  }
  const outsideContent = view.output !== "";
  const wake = { agent, text: ranText(outcome, view), surface: request.surface, outsideContent };
  await wakeAgent(context, wake, ownWork);
}

// Starts an answered request's command as its job, and follows it apart from the call.
function runAnswered(
  context: ShellContext,
  request: OpenShellRequest,
  outcome: RanOutcome,
): Result<RanOutcome, ProtocolErrorCode> {
  const { agent, job, command, folder } = request.view;
  const started = startCommand(context, {
    agent,
    command,
    folder,
    timeoutMs: request.timeoutMs,
    id: job,
  });
  pushClosed(context, request, started.ok ? outcome : "stopped");
  if (!started.ok) {
    return started;
  }
  follow(context, request, outcome).catch(() => {
    context.logger?.warn("shell.answer_untold", { agentId: agent, sourceId: job });
  });
  return ok(outcome);
}

// Whether an agent may still run what its request asked: active and not frozen.
async function mayRun(
  context: ShellContext,
  agent: string,
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const active = await activeAgent(context.wakeParts.agents, idSchema("agt").parse(agent), call);
  return active.ok && active.value.agent.frozenAtMs === undefined;
}

async function answered(
  context: ShellContext,
  request: OpenShellRequest,
  call: {
    readonly answer: "once" | "always";
    readonly caller: EngineCaller;
    readonly signal: AbortSignal;
  },
): Promise<Result<ShellRequestOutcome, ProtocolErrorCode>> {
  if (!(await mayRun(context, request.view.agent, call))) {
    pushClosed(context, request, "stopped");
    return err("agent.frozen");
  }
  if (call.answer === "once") {
    return runAnswered(context, request, "allowed_once");
  }
  await keepAllowed(context.allowed, request.steps, call);
  return runAnswered(context, request, "allowed_always");
}

function answerHandler(context: ShellContext): EngineHandler<"shell/answer"> {
  return async (call) => {
    const { request: id, answer } = call.args;
    const open = context.requests.list().find((view) => view.request === id);
    if (open === undefined) {
      return err("shell.request_closed");
    }
    if (answer === "always" && !open.canAlwaysAllow) {
      return err("shell.always_unavailable");
    }
    const request = context.requests.take(id);
    if (request === undefined) {
      return err("shell.request_closed");
    }
    if (answer === "refuse") {
      pushClosed(context, request, "refused");
      const wake = { agent: open.agent, text: refusedText(open), surface: request.surface };
      await wakeAgent(context, { ...wake, outsideContent: false }, call);
      return ok({ outcome: "refused" });
    }
    const outcome = await answered(context, request, { ...call, answer });
    return outcome.ok ? ok({ outcome: outcome.value }) : outcome;
  };
}

/**
 * What a request no one answered does at its time (decision 0409): `shell.onNoAnswer`, never more
 * than `shell.run` allows, with the line judged again now; one that does not run closes with no
 * turn. A failure is logged, never thrown.
 */
export function lapse(context: ShellContext, request: OpenShellRequest): void {
  const decide = async (): Promise<void> => {
    const { command, folder, agent } = request.view;
    const judged = await judgeCommand(context, { command, folder }, ownWork);
    const runs = judged.ok && runsUnanswered(context.settings(), judged.value.judgment);
    if (!runs || !(await mayRun(context, agent, ownWork))) {
      pushClosed(context, request, "expired");
      return;
    }
    runAnswered(context, request, "ran_unanswered");
  };
  decide().catch(() => {
    context.logger?.warn("shell.lapse_failed", { agentId: request.view.agent });
  });
}

/**
 * Creates `shell/answer` and `shell/requests` (decision 0409). The first answer from a surface
 * with the `confirm` scope wins: Allow once runs the command as the request's job, Always allow
 * also keeps each of its steps as an allowed command, and Refuse wakes the agent with the refusal.
 * An answered command that ends within 10 seconds wakes the agent with its end and output; one
 * that runs on wakes it with its job, and its end is told when it comes.
 */
export function createShellAnswerHandlers(context: ShellContext): ShellAnswerHandlers {
  return {
    "shell/answer": answerHandler(context),
    "shell/requests": async (call) => ok({ items: context.requests.list(call.args.agent) }),
  };
}
