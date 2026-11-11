import { BinferenceError, type Clock, type Id, type IdSource, type Logger } from "@binference/core";
import type { ResultOf, ShellStopper } from "@binference/protocol";
import type { CommandEnd, RunningCommand } from "./command-request.js";

type ShellJobView = ResultOf<"shell/run">;

// The newest output a job keeps; older output is dropped and the next view says so.
const keptOutputChars = 200_000;
// A finished job is kept this long for a last read, and at most this many jobs at once.
const keepFinishedMs = 30 * 60_000;
const mostJobs = 64;

/** One command of an agent, while it runs and for a while after it ends. */
interface ShellJob {
  readonly id: Id<"shj">;
  readonly agent: string;
  readonly command: string;
  readonly folder: string;
  readonly startedAt: number;
  readonly running: RunningCommand;
  /** The newest output, at most {@link keptOutputChars}. */
  readonly kept: string;
  /** Every character the command printed. */
  readonly printed: number;
  /** How many of those an answer already gave. */
  readonly read: number;
  readonly end?: CommandEnd;
  readonly endedAt?: number;
  readonly stoppedBy?: ShellStopper;
  /** A call answered that it runs on, so its end is told (decision 0409). */
  readonly leftRunning: boolean;
  /** The calls that wait for its end now, which read the end themselves. */
  readonly waiters: number;
}

/**
 * A job's end as the jobs hand it on (decision 0409): the job, how it ended, whether a call left it
 * running, whether its end is to be told, and the output no answer gave yet, masked.
 */
export interface EndedJob {
  readonly id: Id<"shj">;
  readonly agent: string;
  readonly command: string;
  readonly folder: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly end: CommandEnd;
  readonly stoppedBy?: ShellStopper;
  readonly leftRunning: boolean;
  /** Left running, ended with no stop, and no call waits to read the end itself. */
  readonly tell: boolean;
  readonly unread: string;
}

/** What the jobs read the clock, new ids and the log through, how they mask output, and who hears an end. */
export interface ShellJobsParts {
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly logger?: Logger;
  readonly mask: (text: string) => string;
  readonly ended?: (job: EndedJob) => void;
}

/** A started command to keep: its agent, its text, the command itself, and the id it was given. */
interface StartedCommand {
  readonly agent: string;
  readonly command: string;
  readonly running: RunningCommand;
  /** The id a shell request gave it before it started (decision 0409). */
  readonly id?: Id<"shj">;
}

/** The agent's commands the engine keeps in memory (decision 0378); none outlives a restart. */
export interface ShellJobs {
  /** Keeps a started command, takes its output from then on, and answers its id. */
  add(started: StartedCommand): Id<"shj">;
  /** The command of the agent's job, while the job is kept. */
  running(agent: string, id: string): RunningCommand | undefined;
  /** Hands output to a job as its command prints it. */
  print(id: Id<"shj">, text: string): void;
  /** The job's view with the output printed since its last view. */
  view(id: Id<"shj">): ShellJobView;
  /** Marks a job a call answered as still running, so its end is told. */
  leave(id: Id<"shj">): void;
  /** Counts a call waiting for the job's end, until the answer it returns is released. */
  hold(id: Id<"shj">): () => void;
  /** Stops a job, recording who stopped it first. */
  stop(id: Id<"shj">, by: ShellStopper): void;
  /** Stops every running job of an agent, or of every agent, and answers how many. */
  stopAgent(agent: string | undefined, by: ShellStopper): number;
}

function endFields(job: ShellJob): Partial<ShellJobView> {
  const { end, endedAt, stoppedBy } = job;
  return {
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(end?.exitCode === undefined ? {} : { exitCode: end.exitCode }),
    ...(end?.signal === undefined ? {} : { signal: end.signal }),
    ...(stoppedBy === undefined ? {} : { stoppedBy }),
  };
}

// The output no view gave yet, as far as the job still keeps it.
function unreadOf(job: ShellJob): { readonly text: string; readonly cut: boolean } {
  const keptFrom = job.printed - job.kept.length;
  const from = Math.max(job.read, keptFrom);
  return { text: job.kept.slice(from - keptFrom), cut: keptFrom > job.read };
}

function viewOf(job: ShellJob, mask: (text: string) => string): ShellJobView {
  const unread = unreadOf(job);
  return {
    job: job.id,
    status: job.end === undefined ? "running" : "ended",
    command: job.command,
    folder: job.folder,
    startedAt: job.startedAt,
    ...endFields(job),
    timedOut: job.end?.timedOut ?? false,
    stopped: job.end?.stopped ?? false,
    output: mask(unread.text),
    outputCut: unread.cut,
  };
}

// The jobs to drop: the finished ones past their keeping time, then the oldest finished past the
// cap.
function droppable(jobs: ReadonlyMap<string, ShellJob>, now: number): readonly string[] {
  const finished = [...jobs.values()].filter((job) => job.endedAt !== undefined);
  const stale = finished.filter((job) => now - (job.endedAt ?? now) > keepFinishedMs);
  const over = finished.slice(0, Math.max(0, jobs.size - stale.length - mostJobs));
  return [...stale, ...over].map((job) => job.id);
}

function endedOf(job: ShellJob, parts: ShellJobsParts): EndedJob {
  const { id, agent, command, folder, startedAt, stoppedBy, leftRunning } = job;
  const end = job.end ?? { timedOut: false, stopped: false };
  const endedAt = job.endedAt ?? job.startedAt;
  const tell = leftRunning && stoppedBy === undefined && job.waiters === 0;
  const unread = parts.mask(unreadOf(job).text);
  const stop = stoppedBy === undefined ? {} : { stoppedBy };
  return {
    id,
    agent,
    command,
    folder,
    startedAt,
    endedAt,
    end,
    ...stop,
    leftRunning,
    tell,
    unread,
  };
}

// Records a job's end when its command ends, logs it without its text or output, and hands it on.
function watchEnd(jobs: Map<string, ShellJob>, parts: ShellJobsParts, id: string): void {
  const ended = (end: CommandEnd): void => {
    const job = jobs.get(id);
    if (job === undefined) {
      return;
    }
    const endedAt = parts.clock.now();
    const done = { ...job, end, endedAt };
    jobs.set(id, done);
    const durationMs = endedAt - job.startedAt;
    parts.logger?.info("shell.ended", { agentId: job.agent, sourceId: id, durationMs });
    parts.ended?.(endedOf(done, parts));
  };
  jobs.get(id)?.running.ended.then(ended, () => {
    ended({ timedOut: false, stopped: false });
  });
}

// Keeps a new job after dropping the ones past their time or the cap.
function addJob(jobs: Map<string, ShellJob>, parts: ShellJobsParts, started: StartedCommand) {
  for (const id of droppable(jobs, parts.clock.now())) {
    jobs.delete(id);
  }
  const id = started.id ?? parts.ids.next("shj");
  const { agent, command, running } = started;
  jobs.set(id, {
    id,
    agent,
    command,
    folder: running.folder,
    startedAt: parts.clock.now(),
    running,
    kept: "",
    printed: 0,
    read: 0,
    leftRunning: false,
    waiters: 0,
  });
  watchEnd(jobs, parts, id);
  return id;
}

// Changes a kept job with `change`; a job no longer kept is left alone.
function update(jobs: Map<string, ShellJob>, id: string, change: (job: ShellJob) => ShellJob) {
  const job = jobs.get(id);
  if (job !== undefined) {
    jobs.set(id, change(job));
  }
}

function stopJob(jobs: Map<string, ShellJob>, id: string, by: ShellStopper): void {
  const job = jobs.get(id);
  if (job?.end === undefined) {
    update(jobs, id, (each) => ({ ...each, stoppedBy: each.stoppedBy ?? by }));
  }
  job?.running.stop();
}

/** Creates the in-memory jobs of the agent's commands. */
export function createShellJobs(parts: ShellJobsParts): ShellJobs {
  const jobs = new Map<string, ShellJob>();
  return {
    add: (started) => addJob(jobs, parts, started),
    running: (agent, id) => {
      const job = jobs.get(id);
      return job?.agent === agent ? job.running : undefined;
    },
    print(id, text) {
      update(jobs, id, (job) => ({
        ...job,
        printed: job.printed + text.length,
        kept: (job.kept + text).slice(-keptOutputChars),
      }));
    },
    view(id) {
      const job = jobs.get(id);
      if (job === undefined) {
        throw new BinferenceError({ code: "shell.job_gone", message: `Shell job ${id} is gone.` });
      }
      jobs.set(id, { ...job, read: job.printed });
      return viewOf(job, parts.mask);
    },
    leave(id) {
      update(jobs, id, (job) => ({ ...job, leftRunning: job.end === undefined }));
    },
    hold(id) {
      update(jobs, id, (job) => ({ ...job, waiters: job.waiters + 1 }));
      return () => {
        update(jobs, id, (job) => ({ ...job, waiters: Math.max(0, job.waiters - 1) }));
      };
    },
    stop: (id, by) => {
      stopJob(jobs, id, by);
    },
    stopAgent(agent, by) {
      const mine = [...jobs.values()].filter(
        (job) => (agent === undefined || job.agent === agent) && job.end === undefined,
      );
      mine.forEach((job) => {
        stopJob(jobs, job.id, by);
      });
      return mine.length;
    },
  };
}
