import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { WorkerValue } from "../worker/worker-messages.schema.js";

/** Where a task runs: `read` on a reader, `write` in one transaction on the writer. */
export type TaskAccess = "read" | "write";

/** What {@link defineTask} builds a store task from. */
export interface TaskSpec<Input, Output> {
  /** Unique within its database, such as `ledger.append`. */
  readonly name: string;
  readonly access: TaskAccess;
  readonly input: z.ZodType<Input>;
  readonly output: z.ZodType<Output>;
  /**
   * The work, on the worker's connection, through Kysely. It is synchronous, never `async`: a
   * write task's queries all run inside one transaction, which nothing else can interleave.
   */
  run(database: DatabaseSync, input: Input): Output;
}

/** A store task as a worker runs it, by name, without its types. */
export interface TaskRunner {
  readonly name: string;
  readonly access: TaskAccess;
  /** Parses the input, runs the task and checks its output, on a store worker. */
  handle(database: DatabaseSync, input: WorkerValue): WorkerValue;
}

/** A named, synchronous unit of database work that a store worker runs. */
export interface StoreTask<Input, Output> extends TaskRunner {
  readonly input: z.ZodType<Input>;
  /** Decodes the output again when it reaches the main thread. */
  readonly output: z.ZodType<Output>;
  /** The input as it crosses to the worker: encoded by its schema, such as an amount as text. */
  encodeInput(input: Input): WorkerValue;
}

/**
 * Defines a store task. The database's worker entry lists it, and `DatabaseHandle.run` sends it
 * to a worker by name. Input and output cross the thread encoded by their schemas and are decoded
 * on the other side, so a codec such as an amount's decimal text works both ways.
 */
export function defineTask<Input, Output>(spec: TaskSpec<Input, Output>): StoreTask<Input, Output> {
  return {
    name: spec.name,
    access: spec.access,
    input: spec.input,
    output: spec.output,
    encodeInput: (input) => z.encode(spec.input, input),
    handle: (database, input) => z.encode(spec.output, spec.run(database, spec.input.parse(input))),
  };
}
