import { BinferenceError } from "@binference/core";
import type { z } from "zod";
import { migrationReportSchema, type MigrationReport } from "../migrations/migration-report.js";
import { integrityReportSchema, type IntegrityReport } from "../sqlite/integrity-report.js";
import { vacuumOutcomeSchema, type VacuumOutcome } from "../sqlite/vacuum-into.js";
import type { StoreTask } from "../tasks/store-task.js";
import type { WorkerValue } from "../worker/worker-messages.schema.js";
import type { WaitOptions } from "./pending-calls.js";
import { startWorker, type CallBody, type WorkerLink } from "./worker-link.js";

/** How {@link openDatabase} opens one database file. */
export interface OpenDatabaseOptions {
  /** The database file; its folder must exist. A missing file is created. */
  readonly file: string;
  /** The database's worker entry, such as `engineWorker`. */
  readonly worker: URL;
  /** Reader workers beside the one writer; with 0 the writer also serves reads. 1 by default. */
  readonly readers?: number;
  /** Node options for the worker threads, such as a TypeScript loader when tests run source. */
  readonly execArgv?: readonly string[];
  readonly signal: AbortSignal;
}

/** The caller's signal for one call, and how long it may wait; the defaults suit each call. */
export interface CallOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * One open database. Its writer worker runs writes one at a time, in the order they arrive, each
 * in its own transaction; reads run on reader workers. Nothing here touches SQLite on the main
 * thread.
 */
export interface DatabaseHandle {
  /** The name its definition gives it, such as `engine`. */
  readonly name: string;
  /** The schema version the file had when it opened, before any migration. */
  readonly schemaVersion: number;
  /** The newest schema version this build knows. */
  readonly latestVersion: number;
  /** Applies pending migrations on the writer. Take a backup first. */
  migrate(options: CallOptions): Promise<MigrationReport>;
  /** Runs a store task: a write on the writer, a read on a reader. */
  run<Input, Output>(
    task: StoreTask<Input, Output>,
    input: Input,
    options: CallOptions,
  ): Promise<Output>;
  /** SQLite's integrity and foreign key checks and the schema version, read on a reader. */
  checkIntegrity(options: CallOptions): Promise<IntegrityReport>;
  /** Writes a compact copy to `target` with `VACUUM INTO`; never replaces a file. */
  vacuumInto(target: string, options: CallOptions): Promise<VacuumOutcome>;
  /** Lets every call sent so far finish, then closes every connection and ends the workers. */
  close(): Promise<void>;
}

const taskTimeoutMs = 30_000;
const maintenanceTimeoutMs = 10 * 60_000;

function parseReply<Output>(schema: z.ZodType<Output>, value: WorkerValue, what: string): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BinferenceError({
      code: "store.bad_reply",
      message: `The store worker's answer to ${what} does not match its schema.`,
      cause: parsed.error,
      details: { what },
    });
  }
  return parsed.data;
}

function waitFor(options: CallOptions, defaultMs: number): WaitOptions {
  return { signal: options.signal, timeoutMs: options.timeoutMs ?? defaultMs };
}

async function maintain(
  link: WorkerLink,
  body: CallBody,
  options: CallOptions,
): Promise<WorkerValue> {
  return link.call(body, waitFor(options, maintenanceTimeoutMs));
}

function createHandle(writer: WorkerLink, readers: readonly WorkerLink[]): DatabaseHandle {
  let turn = 0;
  const reader = (): WorkerLink => {
    turn = (turn + 1) % Math.max(readers.length, 1);
    return readers[turn] ?? writer;
  };
  return {
    name: writer.ready.database,
    schemaVersion: writer.ready.schemaVersion,
    latestVersion: writer.ready.latestVersion,
    migrate: async (options) =>
      parseReply(
        migrationReportSchema,
        await maintain(writer, { kind: "migrate" }, options),
        "migrate",
      ),
    run: async (task, input, options) => {
      const link = task.access === "write" ? writer : reader();
      const value = await link.call(
        { kind: "task", task: task.name, input },
        waitFor(options, taskTimeoutMs),
      );
      return parseReply(task.output, value, task.name);
    },
    checkIntegrity: async (options) =>
      parseReply(
        integrityReportSchema,
        await maintain(reader(), { kind: "integrity" }, options),
        "integrity",
      ),
    vacuumInto: async (target, options) =>
      parseReply(
        vacuumOutcomeSchema,
        await maintain(reader(), { kind: "vacuum", target }, options),
        "vacuum",
      ),
    close: async () => {
      await Promise.all(readers.map(async (link) => link.close()));
      await writer.close();
    },
  };
}

async function startReaders(options: OpenDatabaseOptions, count: number): Promise<WorkerLink[]> {
  const started = await Promise.allSettled(
    Array.from({ length: count }, async () =>
      startWorker({
        url: options.worker,
        setup: { role: "reader", file: options.file },
        execArgv: options.execArgv ?? [],
        signal: options.signal,
      }),
    ),
  );
  const readers = started.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  const failure = started.find((outcome) => outcome.status === "rejected");
  if (failure !== undefined) {
    await Promise.all(readers.map(async (link) => link.close()));
    throw failure.reason;
  }
  return readers;
}

/**
 * Opens a database on worker threads: the writer first, then the readers. A file with a schema
 * newer than this build knows is refused with `store.newer_schema`. Migrations do not run here;
 * call `migrate` after the backup.
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<DatabaseHandle> {
  const writer = await startWorker({
    url: options.worker,
    setup: { role: "writer", file: options.file },
    execArgv: options.execArgv ?? [],
    signal: options.signal,
  });
  try {
    return createHandle(writer, await startReaders(options, options.readers ?? 1));
  } catch (error) {
    await writer.close();
    throw error;
  }
}
