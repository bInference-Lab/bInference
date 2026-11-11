import { type Id, idSchema } from "@binference/core";
import type { ChatSurface, ShellStopper } from "@binference/protocol";
import { wakeWithMessage } from "../chat/engine-message.js";
import { activeAgent } from "../operations/active-agent.js";
import { pushClosed, type ShellContext, type ShellWake } from "./shell-context.js";
import type { EndedJob } from "./shell-jobs.js";
import { endedText, lostText } from "./shell-words.js";

// A wake outside any call: the engine's own work, which a stop of the engine ends with the process.
const ownWork = { signal: new AbortController().signal };

/**
 * Starts the agent's next turn with binference's words, while the agent is active and not frozen
 * (decision 0409). A full inbox drops the words, as a helper's report is dropped.
 */
export async function wakeAgent(
  context: ShellContext,
  wake: ShellWake,
  call: { readonly signal: AbortSignal },
): Promise<void> {
  const agent = idSchema("agt").parse(wake.agent);
  const active = await activeAgent(context.wakeParts.agents, agent, call);
  if (!active.ok || active.value.agent.frozenAtMs !== undefined) {
    return;
  }
  const { text, surface, outsideContent } = wake;
  await wakeWithMessage(context.wakeParts, { agent, text, surface, outsideContent }, call.signal);
}

/**
 * Marks a job a call answered as still running (decision 0409): its end is told, and its row is
 * kept until then, so a restart that loses it is told too.
 */
export function leaveRunning(
  context: ShellContext,
  job: { readonly id: Id<"shj">; readonly agent: string; readonly surface: ChatSurface },
  view: { readonly command: string; readonly folder: string; readonly startedAt: number },
): void {
  context.jobs.leave(job.id);
  if (context.left.has(job.id)) {
    return;
  }
  const watch = {
    job: job.id,
    agentId: idSchema("agt").parse(job.agent),
    command: view.command,
    folder: view.folder,
    startedAtMs: view.startedAt,
    surface: job.surface,
  };
  // A row that could not be written only loses the telling of a restart; the end is still told.
  const written = context.store.watch(watch, ownWork).catch(() => {
    context.logger?.warn("shell.watch_unwritten", { agentId: job.agent, sourceId: job.id });
  });
  context.left.set(job.id, { surface: job.surface, written });
}

// An end that needs no turn: exit code 0, nothing printed since the agent last read it.
function isQuietSuccess(job: EndedJob): boolean {
  return job.end.exitCode === 0 && !job.end.timedOut && job.unread === "";
}

async function tellEnd(context: ShellContext, job: EndedJob): Promise<void> {
  const left = context.left.get(job.id);
  if (left === undefined) {
    return;
  }
  context.left.delete(job.id);
  await left.written;
  const dropped = await context.store.unwatch(job.id, ownWork);
  const quiet = isQuietSuccess(job) && !context.settings().tellOnQuietEnd;
  if (!dropped || !job.tell || quiet) {
    return;
  }
  const text = endedText(job);
  const wake = { agent: job.agent, text, surface: left.surface, outsideContent: job.unread !== "" };
  await wakeAgent(context, wake, ownWork);
}

/**
 * Hears each job's end: a job a call left running drops its row and, unless a stop ended it, a
 * call waits to read the end, or it ended quietly with `shell.tellOnQuietEnd` off, wakes its agent
 * with its end (decision 0409). A failure is logged, never thrown.
 */
export function hearEnd(context: ShellContext, job: EndedJob): void {
  tellEnd(context, job).catch(() => {
    context.logger?.warn("shell.end_untold", { agentId: job.agent, sourceId: job.id });
  });
}

/**
 * Stops every running command of an agent, or of every agent, and closes its open request, for
 * the owner's stop or a freeze (decision 0409). Nothing it stops wakes the agent.
 */
export function stopAgentShell(
  context: ShellContext,
  agent: string | undefined,
  by: Exclude<ShellStopper, "agent">,
): void {
  context.jobs.stopAgent(agent, by);
  for (const view of context.requests.list(agent)) {
    const taken = context.requests.take(view.request);
    if (taken !== undefined) {
      pushClosed(context, taken, "stopped");
    }
  }
}

/**
 * Tells each agent of a command the last stop of the engine lost while it ran: the rows no job of
 * this run holds. Answers how many it told.
 */
export async function tellLostJobs(
  context: ShellContext,
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const lost = (await context.store.watched(call)).filter((watch) => !context.left.has(watch.job));
  let told = 0;
  for (const watch of lost) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one row at a time, in order
    if (await context.store.unwatch(watch.job, call)) {
      const wake = { agent: watch.agentId, text: lostText(watch), surface: watch.surface };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one wake at a time, in order
      await wakeAgent(context, { ...wake, outsideContent: false }, call);
      told += 1;
    }
  }
  return told;
}
