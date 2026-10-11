import { isAbsolute } from "node:path";
import { BinferenceError, createIdSource, err, jsonValueSchema, ok } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { BackupFailure, BackupRecord } from "@binference/engine/backups";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type {
  BackupView,
  JobDonePush,
  JobFailedPush,
  ProtocolErrorCode,
  ProtocolId,
} from "@binference/protocol";
import type { BackupParts } from "../backups/backup-parts.js";
import { takeBackup } from "../backups/take-backup.js";
import type { Closers } from "./closers.js";
import { backupPartsOf, backupRunOf } from "./compose-backups.js";
import type { ConfigCell } from "./config-cell.js";
import type { Opened, Opening } from "./open-engine-parts.js";

/** What the backup operations read, and where a backup job's end goes. */
export interface BackupOperationsOptions {
  readonly parts: BackupParts;
  /** The config as it stands, for `backups.copyTo` and retention. */
  readonly settings: ConfigCell;
  /** The engine's one publish; a job's end goes to the `job` topic. */
  readonly publish: PublishPush;
  /** Where the operations add what stops a job under way. */
  readonly closers: Closers;
}

const failureCodes: { readonly [F in BackupFailure]: ProtocolErrorCode } = {
  no_owner_key: "backup.no_owner_key",
  snapshot: "backup.snapshot_failed",
  write: "backup.write_failed",
  check: "backup.check_failed",
  copy: "backup.copy_failed",
};

/** A backup record as the protocol shows it. */
function backupViewOf(record: BackupRecord): BackupView {
  const view = {
    backup: record.id,
    kind: record.kind,
    bytes: record.bytes,
    createdAt: record.createdAtMs,
  };
  return record.verifiedAtMs === undefined ? view : { ...view, verifiedAt: record.verifiedAtMs };
}

function donePush(job: ProtocolId<"longJob">, record: BackupRecord): JobDonePush {
  return { job, op: "backup/create", result: jsonValueSchema.parse(backupViewOf(record)) };
}

function failedPush(job: ProtocolId<"longJob">, failure: BackupFailure): JobFailedPush {
  const code = failureCodes[failure];
  const retryable = failure !== "no_owner_key";
  return {
    job,
    op: "backup/create",
    error: { code, message: `A backup failed: ${code}.`, retryable },
  };
}

// Takes one backup by hand and publishes how it ended; a stop of the engine ends it unannounced.
async function runJob(
  options: BackupOperationsOptions,
  job: { readonly id: ProtocolId<"longJob">; readonly copyTo?: string },
  stop: AbortSignal,
): Promise<void> {
  const { parts, settings, publish } = options;
  const config = settings.current();
  const run = backupRunOf(
    config,
    { kind: "manual", engineSchemaVersion: parts.engineDatabase.latestVersion },
    stop,
  );
  try {
    const taken = await takeBackup(
      parts,
      job.copyTo === undefined ? run : { ...run, copyTo: job.copyTo },
    );
    if (stop.aborted) {
      return;
    }
    const push = taken.ok ? donePush(job.id, taken.value) : failedPush(job.id, taken.error);
    const kind = taken.ok ? "job/done" : "job/failed";
    publish({ topic: "job", kind, data: jsonValueSchema.parse(push) });
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    parts.logger.warn("backup.job_stopped", { errorCode });
  }
}

/**
 * The handlers of `backup/list` and `backup/create` (protocol spec, section 7.9). The list gives
 * every backup `engine.sqlite` records, newest first. A create answers a job at once and takes a
 * `manual` backup, which retention never removes, with its second copy in `copyTo` or else in
 * `backups.copyTo`; the job's end goes to the `job` topic as `job/done` with the backup, or
 * `job/failed` with a `backup` code. While one runs, a create answers its job. A `copyTo` that is
 * not an absolute folder is `protocol.bad_args`. Its closer stops a job under way and waits for it.
 */
export function createBackupOperations(options: BackupOperationsOptions): EngineHandlerTable {
  const { parts } = options;
  const ids = createIdSource({ clock: parts.clock, random: parts.random });
  const stop = new AbortController();
  const running: { job: ProtocolId<"longJob"> | undefined; ended: Promise<void> } = {
    job: undefined,
    ended: Promise.resolve(),
  };
  options.closers.add("backup jobs", async () => {
    stop.abort();
    await running.ended;
  });
  return {
    "backup/list": async ({ signal }) => {
      const records = await parts.backups.list({ signal });
      return ok({ items: records.toReversed().map(backupViewOf) });
    },
    "backup/create": async ({ args }) => {
      if (args.copyTo !== undefined && !isAbsolute(args.copyTo)) {
        return err("protocol.bad_args");
      }
      if (running.job !== undefined) {
        return ok({ job: running.job });
      }
      const id = ids.next("job");
      const job = args.copyTo === undefined ? { id } : { id, copyTo: args.copyTo };
      running.job = id;
      running.ended = runJob(options, job, stop.signal).finally(() => {
        running.job = undefined;
      });
      return ok({ job: id });
    },
  };
}

/**
 * The backup operations of the self-hosted engine, over the stores the start opened and the
 * config cell; a job's end goes to `publish`.
 */
export function composeBackupOperations(
  opening: Opening,
  opened: Opened,
  publish: PublishPush,
): EngineHandlerTable {
  return createBackupOperations({
    parts: backupPartsOf(opening, opened.stores.backups, opened.log.logger),
    settings: opened.settings,
    publish,
    closers: opening.closers,
  });
}
