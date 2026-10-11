import { access } from "node:fs/promises";
import { err, ok, type Result } from "@binference/core";
import type { VacuumOutcome } from "../sqlite/vacuum-into.js";
import { openDatabase } from "./open-database.js";

/** Which database file {@link snapshotDatabase} copies, and where to. */
export interface SnapshotOptions {
  /** The database file. */
  readonly file: string;
  /** Its worker entry, such as `agentWorker`. */
  readonly worker: URL;
  /** Where the copy goes; its folder must exist and the file must not. */
  readonly target: string;
  /** Node options for the worker thread, such as a TypeScript loader when tests run source. */
  readonly execArgv?: readonly string[];
  readonly signal: AbortSignal;
}

/** A snapshot {@link snapshotDatabase} wrote: the copy, and the schema version it holds. */
export interface Snapshot {
  readonly file: string;
  readonly bytes: number;
  readonly schemaVersion: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a consistent copy of a database that no handle of this process holds open, with `VACUUM
 * INTO` on a store worker it starts and closes, such as `agent.sqlite` while the engine keeps
 * only `engine.sqlite` open. A file that is not there is `not_found`, and nothing is created;
 * a target that exists is `target_exists`. A database newer than this build knows is refused
 * with `store.newer_schema`, as opening it is.
 */
export async function snapshotDatabase(
  options: SnapshotOptions,
): Promise<Result<Snapshot, "not_found" | "target_exists">> {
  options.signal.throwIfAborted();
  if (!(await exists(options.file))) {
    return err("not_found");
  }
  const database = await openDatabase({
    file: options.file,
    worker: options.worker,
    readers: 0,
    execArgv: options.execArgv ?? [],
    signal: options.signal,
  });
  let copied: VacuumOutcome;
  try {
    copied = await database.vacuumInto(options.target, { signal: options.signal });
  } finally {
    await database.close();
  }
  return copied.ok ? ok({ ...copied.value, schemaVersion: database.schemaVersion }) : copied;
}
