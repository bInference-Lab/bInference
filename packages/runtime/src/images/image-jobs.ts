import type { Id } from "@binference/core";

/** An image job that runs for an agent: what it makes and since when. */
export interface RunningImageJob {
  readonly prompt: string;
  readonly count: number;
  readonly startedAtMs: number;
}

/**
 * The agents' image jobs (decision 0392): at most one per agent, each run after the call that
 * started it has answered, so the turn ends while the model works. A job holds its place until its
 * work ends, however it ends.
 */
export interface ImageJobs<Job = RunningImageJob> {
  /** The job that runs for the agent now, if any. */
  running(agent: Id<"agt">): Job | undefined;
  /**
   * Runs `work` as the agent's job; false, running nothing, while another job of the agent runs.
   * A fault of the work is swallowed: the work tells the engine how its job ended itself.
   */
  start(agent: Id<"agt">, job: Job, work: () => Promise<void>): boolean;
}

/** Creates the {@link ImageJobs} of one runtime process, of images or of another kind of job. */
export function createImageJobs<Job = RunningImageJob>(): ImageJobs<Job> {
  const jobs = new Map<string, Job>();
  return {
    running: (agent) => jobs.get(agent),
    start: (agent, job, work) => {
      if (jobs.has(agent)) {
        return false;
      }
      jobs.set(agent, job);
      void work()
        .catch(() => undefined)
        .finally(() => jobs.delete(agent));
      return true;
    },
  };
}
