// The messages between a Postgres task thread, which runs store tasks synchronously, and the
// thread that runs their statements on Postgres (decision 0369). Payloads cross by structured
// clone; the shared words below only wake the task thread.
import { z } from "zod";
import {
  type WorkerError,
  workerErrorSchema,
  type WorkerValue,
} from "../worker/worker-messages.schema.js";

/**
 * The shared words, as `Int32Array` indexes: `posted` counts the messages the statement side
 * sent, so a task thread waiting on it wakes for each; `aborted` holds the number of the run the
 * caller aborted.
 */
export const bridgeWords = { posted: 0, aborted: 1, length: 2 } as const;

/** What a task thread receives as `workerData`: the shared words and its wait bound. */
export interface PostgresTaskSetup {
  readonly kind: "postgres";
  /** {@link bridgeWords}, over a `SharedArrayBuffer`. */
  readonly words: SharedArrayBuffer;
  /** How long a task waits for one statement's answer before it gives up. */
  readonly waitMs: number;
}

/** Checks `workerData` in a task thread; a SQLite store worker's setup fails it. */
export const postgresTaskSetupSchema: z.ZodType<PostgresTaskSetup> = z.strictObject({
  kind: z.literal("postgres"),
  words: z.instanceof(SharedArrayBuffer),
  waitMs: z.number().int().positive(),
});

/** Runs one store task, by name, in one Postgres transaction the statement side holds. */
export interface RunMessage {
  readonly kind: "run";
  /** Numbers each run, so an abort of an earlier run never stops a later one. */
  readonly run: number;
  readonly task: string;
  readonly schema: string;
  readonly input: WorkerValue;
}

/** Asks the task thread to stop serving and end. */
interface StopMessage {
  readonly kind: "stop";
}

/** The answer to one statement: its rows and affected-row count, or that it failed. */
export type ResultMessage =
  | {
      readonly kind: "result";
      readonly statement: number;
      readonly ok: true;
      readonly rows: readonly Readonly<Record<string, WorkerValue>>[];
      readonly numAffectedRows?: bigint;
    }
  | { readonly kind: "result"; readonly statement: number; readonly ok: false };

/** Every message the statement side sends a task thread. */
export type ToTaskThread = RunMessage | StopMessage | ResultMessage;

/** One compiled statement a task asks the statement side to run in its transaction. */
export interface StatementMessage {
  readonly kind: "statement";
  /** Numbers each statement across every run, so a late answer is never taken for another. */
  readonly statement: number;
  readonly sql: string;
  readonly parameters: readonly WorkerValue[];
}

/** The task thread serves runs for its database. */
export interface ServingMessage {
  readonly kind: "serving";
  readonly database: string;
}

/** A run ended: the task's encoded output, or the fault that ended it. */
export type EndedMessage =
  | { readonly kind: "ended"; readonly run: number; readonly ok: true; readonly value: WorkerValue }
  | {
      readonly kind: "ended";
      readonly run: number;
      readonly ok: false;
      readonly error: WorkerError;
    };

/** Every message a task thread sends the statement side. */
export type FromTaskThread = StatementMessage | ServingMessage | EndedMessage;

const counter = z.number().int().nonnegative();

/** Checks a message on the task thread. */
export const toTaskThreadSchema: z.ZodType<ToTaskThread> = z.union([
  z.strictObject({
    kind: z.literal("run"),
    run: counter,
    task: z.string().min(1),
    schema: z.string().min(1),
    input: z.unknown(),
  }),
  z.strictObject({ kind: z.literal("stop") }),
  z.strictObject({
    kind: z.literal("result"),
    statement: counter,
    ok: z.literal(true),
    rows: z.array(z.record(z.string(), z.unknown())),
    numAffectedRows: z.bigint().nonnegative().exactOptional(),
  }),
  z.strictObject({ kind: z.literal("result"), statement: counter, ok: z.literal(false) }),
]);

/** Checks a message from a task thread on the statement side. */
export const fromTaskThreadSchema: z.ZodType<FromTaskThread> = z.union([
  z.strictObject({
    kind: z.literal("statement"),
    statement: counter,
    sql: z.string().min(1),
    parameters: z.array(z.unknown()),
  }),
  z.strictObject({ kind: z.literal("serving"), database: z.string() }),
  z.strictObject({
    kind: z.literal("ended"),
    run: counter,
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.strictObject({
    kind: z.literal("ended"),
    run: counter,
    ok: z.literal(false),
    error: workerErrorSchema,
  }),
]);
