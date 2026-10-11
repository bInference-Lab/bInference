import { BinferenceError, jsonValueSchema } from "@binference/core";
import {
  type BackupView,
  backupViewSchema,
  operations,
  protocolErrorCodes,
  type ProtocolErrorCode,
  type ProtocolId,
} from "@binference/protocol";
import { z } from "zod";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine, withEngineWithin } from "./connect-engine.js";
import { type JobEnd, type JobEnds, watchJobEnds } from "./job-ends.js";

// A backup by hand may take a while on a large install: the command waits up to 10 minutes.
const createBudgetMs = 10 * 60_000;
const kib = 1_024;

function backupValues(run: CommandRun, backup: BackupView) {
  return {
    backup: backup.backup,
    kind: backup.kind,
    createdAt: run.formatter.dateTime(backup.createdAt),
    kib: Math.max(1, Math.ceil(backup.bytes / kib)),
    checked: backup.verifiedAt === undefined ? "no" : "yes",
  };
}

function isProtocolCode(code: string): code is ProtocolErrorCode {
  return protocolErrorCodes.some((known) => known === code);
}

function reportEnd(run: CommandRun, end: JobEnd): ExitCode {
  const { output } = run;
  if (end.kind === "failed") {
    const { code } = end.push.error;
    if (isProtocolCode(code)) {
      output.refuse(code);
    } else {
      output.fail({ code, key: "connect.failed", values: { code } });
    }
    return 1;
  }
  const backup = backupViewSchema.parse(end.push.result);
  output.json(jsonValueSchema.parse(z.encode(backupViewSchema, backup)));
  output.say("backup.made", backupValues(run, backup));
  return 0;
}

// The wait ended without the job's end: the budget ran out, or the engine stopped.
function reportUnended(run: CommandRun, error: Error): ExitCode {
  const isStopped = error instanceof BinferenceError && error.code.startsWith("client.");
  run.output.fail({
    code: isStopped ? "engine.stopping" : "engine.timeout",
    key: isStopped ? "backup.engineStopped" : "backup.stillRunning",
  });
  return 1;
}

// The job's end, or why the wait for it ended first.
async function endOrError(
  ends: JobEnds,
  job: ProtocolId<"longJob">,
  signal: AbortSignal,
): Promise<JobEnd | Error> {
  try {
    return await ends.of(job, signal);
  } catch (error) {
    return error instanceof Error ? error : new Error("The wait for the backup ended.");
  }
}

/**
 * `binference backup create`: takes a backup now through `backup/create` over IPC (keys spec,
 * section 7), kept until the owner removes it, its second copy in `backups.copyTo` when set. The
 * command waits up to 10 minutes for the job's end on the `job` topic and prints the backup, or
 * the reason it failed. With `--json` it prints the backup as `backup/list` shows it, or
 * `{ error: { code } }`.
 */
export async function runBackupCreate(run: CommandRun): Promise<ExitCode> {
  const { host } = run;
  return withEngineWithin(host, run.output, {
    budgetMs: createBudgetMs,
    use: async (client, signal) => {
      const ends = watchJobEnds(client, host.clock);
      try {
        const { job } = await client.call("backup/create", {}, { signal });
        const end = await endOrError(ends, job, signal);
        return end instanceof Error ? reportUnended(run, end) : reportEnd(run, end);
      } finally {
        ends.close();
      }
    },
  });
}

/**
 * `binference backup list`: every backup the install holds, newest first, through `backup/list`
 * over IPC: its id, why it was taken, when, its size, and whether it was checked. With `--json`
 * it prints the page as the protocol answers it.
 */
export async function runBackupList(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("backup/list", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["backup/list"].result, page)));
    output.say("backup.count", { count: page.items.length });
    for (const backup of page.items) {
      output.item("backup.item", backupValues(run, backup));
    }
    return 0;
  });
}
