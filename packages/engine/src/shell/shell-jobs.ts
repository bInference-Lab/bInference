import { BinferenceError, type Clock, type Id, type IdSource, type Logger } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
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
}

/** What the jobs read the clock, new ids and the log through, and how they mask output. */
export interface ShellJobsParts {
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly logger?: Logger;
  readonly mask: (text: string) => string;
}

/** A started command to keep: its agent, its text, and the command itself. */
interface StartedCommand {
  readonly agent: string;
  readonly command: string;
  readonly running: RunningCommand;
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
}

function endFields(job: ShellJob): Partial<ShellJobView> {
  const { end, endedAt } = job;
  return {
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(end?.exitCode === undefined ? {} : { exitCode: end.exitCode }),
    ...(end?.signal === undefined ? {} : { signal: end.signal }),
  };
}

function viewOf(job: ShellJob, mask: (text: string) => string): ShellJobView {
  const keptFrom = job.printed - job.kept.length;
  const from = Math.max(job.read, keptFrom);
  return {
    job: job.id,
    status: job.end === undefined ? "running" : "ended",
    command: job.command,
    folder: job.folder,
    startedAt: job.startedAt,
    ...endFields(job),
    timedOut: job.end?.timedOut ?? false,
    stopped: job.end?.stopped ?? false,
    output: mask(job.kept.slice(from - keptFrom)),
    outputCut: keptFrom > job.read,
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

// Records a job's end when its command ends, and logs it without its text or output.
function watchEnd(jobs: Map<string, ShellJob>, parts: ShellJobsParts, id: string): void {
  const ended = (end: CommandEnd): void => {
    const job = jobs.get(id);
    if (job === undefined) {
      return;
    }
    const endedAt = parts.clock.now();
    jobs.set(id, { ...job, end, endedAt });
    const durationMs = endedAt - job.startedAt;
    parts.logger?.info("shell.ended", { agentId: job.agent, sourceId: id, durationMs });
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
  const id = parts.ids.next("shj");
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
  });
  watchEnd(jobs, parts, id);
  return id;
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
      const job = jobs.get(id);
      if (job !== undefined) {
        const printed = job.printed + text.length;
        jobs.set(id, { ...job, printed, kept: (job.kept + text).slice(-keptOutputChars) });
      }
    },
    view(id) {
      const job = jobs.get(id);
      if (job === undefined) {
        throw new BinferenceError({ code: "shell.job_gone", message: `Shell job ${id} is gone.` });
      }
      jobs.set(id, { ...job, read: job.printed });
      return viewOf(job, parts.mask);
    },
  };
}
