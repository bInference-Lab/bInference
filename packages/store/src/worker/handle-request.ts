import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import type { DatabaseDefinition } from "../databases/database-definition.js";
import { latestVersion, runMigrations } from "../migrations/run-migrations.js";
import { checkIntegrity } from "../sqlite/integrity-check.js";
import type { ConnectionRole } from "../sqlite/open-connection.worker.js";
import { readTransaction, writeTransaction } from "../sqlite/transaction.js";
import { vacuumInto } from "../sqlite/vacuum-into.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { toWorkerError } from "./worker-error.js";
import type {
  CloseRequest,
  ReplyMessage,
  TaskRequest,
  WorkerRequest,
  WorkerValue,
} from "./worker-messages.schema.js";

/** What a store worker serves requests with: its connection, its role and its database. */
export interface WorkerContext {
  readonly database: DatabaseSync;
  readonly role: ConnectionRole;
  readonly definition: DatabaseDefinition;
  readonly tasks: ReadonlyMap<string, TaskRunner>;
  readonly latestVersion: number;
}

/** Builds a worker's context; refuses a definition that lists two tasks under one name. */
export function createWorkerContext(
  database: DatabaseSync,
  role: ConnectionRole,
  definition: DatabaseDefinition,
): WorkerContext {
  const tasks = new Map<string, TaskRunner>();
  for (const task of definition.tasks) {
    if (tasks.has(task.name)) {
      throw new BinferenceError({
        code: "store.duplicate_task",
        message: `The ${definition.name} database lists the task ${task.name} twice.`,
        details: { database: definition.name, task: task.name },
      });
    }
    tasks.set(task.name, task);
  }
  return { database, role, definition, tasks, latestVersion: latestVersion(definition.migrations) };
}

function writerOnly(context: WorkerContext, what: string): void {
  if (context.role !== "writer") {
    throw new BinferenceError({
      code: "store.writer_only",
      message: `A reader of the ${context.definition.name} database was asked to ${what}; only its writer may.`,
      details: { database: context.definition.name },
    });
  }
}

function runTask(context: WorkerContext, request: TaskRequest): WorkerValue {
  const task = context.tasks.get(request.task);
  if (task === undefined) {
    throw new BinferenceError({
      code: "store.unknown_task",
      message: `The ${context.definition.name} database has no task ${request.task}; list it in its definition.`,
      details: { database: context.definition.name, task: request.task },
    });
  }
  const work = (): WorkerValue => task.handle(context.database, request.input);
  if (task.access === "write") {
    writerOnly(context, `run ${task.name}`);
    return writeTransaction(context.database, work);
  }
  return readTransaction(context.database, work);
}

function answer(
  context: WorkerContext,
  request: Exclude<WorkerRequest, CloseRequest>,
): WorkerValue {
  if (request.kind === "task") {
    return runTask(context, request);
  }
  if (request.kind === "migrate") {
    writerOnly(context, "migrate");
    return runMigrations(context.database, context.definition);
  }
  if (request.kind === "integrity") {
    return checkIntegrity(context.database, context.latestVersion);
  }
  return vacuumInto(context.database, request.target);
}

/** Serves one request synchronously. A fault becomes an error reply; nothing is thrown. */
export function handleRequest(
  context: WorkerContext,
  request: Exclude<WorkerRequest, CloseRequest>,
): ReplyMessage {
  try {
    return { kind: "reply", id: request.id, ok: true, value: answer(context, request) };
  } catch (error) {
    return { kind: "reply", id: request.id, ok: false, error: toWorkerError(error) };
  }
}
