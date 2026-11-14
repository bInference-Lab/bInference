import {
  BinferenceError,
  type Clock,
  createDeadline,
  err,
  jsonValueSchema,
  type Logger,
  ok,
  type Random,
} from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  type CheckFindingView,
  type CheckReportView,
  maxCheckFindings,
  type ProtocolId,
} from "@binference/protocol";
import { checkFindings } from "../commands/check-command.js";
import type { CheckFinding } from "../commands/check-finding.js";
import type { Closers } from "./closers.js";
import { createHandlerReach } from "./handler-reach.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { createSingleJob } from "./single-job.js";

/** What `check/run` runs and where its jobs end. */
export interface CheckOperationsOptions {
  /** Every finding of `binference check`, without `--fix`, within the signal. */
  run(signal: AbortSignal): Promise<readonly CheckFinding[]>;
  readonly clock: Clock;
  readonly random: Random;
  /** The engine's one publish; a run's end goes to the `job` topic. */
  readonly publish: PublishPush;
  readonly closers: Closers;
  readonly logger: Logger;
}

// A run has the CLI's own budget, and its report answers every call for a minute (decision 0445).
const runBudgetMs = 15_000;
const keptMs = 60_000;
const op = "check/run";

// A finding as the console reads it: its id, level and words, without what only scripts read.
function viewOf(finding: CheckFinding): CheckFindingView {
  const { check, level, message, more } = finding;
  return {
    check,
    level,
    ...(message === undefined ? {} : { message }),
    ...(more === undefined || more.length === 0 ? {} : { more }),
  };
}

// One run of the checks within the budget, as the report a job ends with.
async function runChecks(
  options: CheckOperationsOptions,
  stop: AbortSignal,
): Promise<CheckReportView> {
  const deadline = createDeadline({ clock: options.clock, signal: stop, timeoutMs: runBudgetMs });
  try {
    const findings = await options.run(deadline.signal);
    const shown = findings.slice(0, maxCheckFindings).map(viewOf);
    return { findings: shown, ranAt: options.clock.now() };
  } finally {
    deadline.clear();
  }
}

/** One check run's job: the report kept to the checks a call named, or why it failed. */
interface CheckJob {
  readonly job: ProtocolId<"longJob">;
  readonly only?: ReadonlySet<string>;
}

// The runs of the checks, with the last report, which answers every call for a minute.
function createCheckRuns(options: CheckOperationsOptions) {
  let kept: CheckReportView | undefined;
  const fresh = () =>
    kept !== undefined && options.clock.now() - kept.ranAt < keptMs ? kept : undefined;
  const failed = (job: ProtocolId<"longJob">, errorCode: string) => {
    const code = errorCode === "core.timeout" ? "engine.timeout" : "internal.error";
    const error = { code, message: "The checks did not finish.", retryable: true };
    options.publish({ topic: "job", kind: "job/failed", data: { job, op, error } });
  };
  return async (run: CheckJob, stop: AbortSignal): Promise<void> => {
    try {
      const report = fresh() ?? (await runChecks(options, stop));
      kept = report;
      const findings = report.findings.filter(({ check }) => run.only?.has(check) ?? true);
      const done = { job: run.job, op, result: { ...report, findings } };
      options.publish({ topic: "job", kind: "job/done", data: jsonValueSchema.parse(done) });
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      options.logger.warn("check.run_failed", { errorCode });
      if (!stop.aborted) {
        failed(run.job, errorCode);
      }
    }
  };
}

/**
 * The handler of `check/run` (decision 0445): `fix` is refused with `check.terminal_only`;
 * otherwise it answers a job at once and runs every finding of `binference check` within 15
 * seconds, one run at a time, so a call while one runs gets its job. The job ends on the `job`
 * topic with the report, at most 200 findings in the order the terminal prints them, kept to the
 * check ids `only` names. A report answers every call for 60 seconds: a job then ends at once with
 * it, and runs nothing. A run that throws ends `job/failed`; the engine's stop ends it unannounced.
 */
export function createCheckOperations(options: CheckOperationsOptions): EngineHandlerTable {
  const jobs = createSingleJob({ ...options, name: "check runs" });
  const runJob = createCheckRuns(options);
  return {
    "check/run": async ({ args }) => {
      if (args.fix === true) {
        return err("check.terminal_only");
      }
      const only = args.only === undefined ? {} : { only: new Set(args.only) };
      const job = jobs.start(async (started, stop) => runJob({ job: started, ...only }, stop));
      return ok({ job });
    },
  };
}

/** What the self-hosted root's check runs read besides the start's parts. */
export interface CheckWiring {
  /** Every handler of the engine, read on each call: the root fills it once the engine exists. */
  handlers(): EngineHandlerTable;
  /** Where a run's end goes, once the engine's publish exists. */
  readonly publish: PublishPush;
}

/**
 * `check/run` of the self-hosted engine (decision 0445): the findings of `binference check` on
 * the start's host, in the engine's own process, each that reads the engine reading its handlers
 * as the CLI's caller.
 */
export function composeCheckOperations(
  opening: Opening,
  opened: Opened,
  wiring: CheckWiring,
): EngineHandlerTable {
  const { host, closers } = opening;
  const reach = createHandlerReach(() => wiring.handlers(), host.version);
  return createCheckOperations({
    run: async (signal) => checkFindings({ host, fix: false, signal, reach }),
    clock: host.clock,
    random: host.random,
    publish: wiring.publish,
    closers,
    logger: opened.log.logger.child("check"),
  });
}
