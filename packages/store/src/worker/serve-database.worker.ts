import type { DatabaseSync } from "node:sqlite";
import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import { BinferenceError } from "@binference/core";
import type { DatabaseDefinition } from "../databases/database-definition.js";
import { assertKnownVersion } from "../migrations/run-migrations.js";
import { readSchemaVersion } from "../migrations/schema-version.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { createWorkerContext, handleRequest, type WorkerContext } from "./handle-request.js";
import { toWorkerError } from "./worker-error.js";
import {
  workerRequestSchema,
  workerSetupSchema,
  type ReadyMessage,
  type RefusedMessage,
  type WorkerSetup,
  type WorkerValue,
} from "./worker-messages.schema.js";

interface Opened {
  readonly context: WorkerContext;
  readonly ready: ReadyMessage;
}

// A refused worker closes what it opened before it ends, so the main thread can delete the file.
function open(definition: DatabaseDefinition, setup: WorkerSetup): Opened | RefusedMessage {
  let database: DatabaseSync | undefined;
  try {
    database = openConnection(setup.file, {
      role: setup.role,
      synchronous: definition.synchronous,
    });
    const context = createWorkerContext(database, setup.role, definition);
    const schemaVersion = readSchemaVersion(database);
    assertKnownVersion(definition.name, schemaVersion, context.latestVersion);
    const ready: ReadyMessage = {
      kind: "ready",
      database: definition.name,
      schemaVersion,
      latestVersion: context.latestVersion,
    };
    return { context, ready };
  } catch (error) {
    database?.close();
    return { kind: "refused", error: toWorkerError(error) };
  }
}

function serve(port: MessagePort, context: WorkerContext): void {
  port.on("message", (message: WorkerValue) => {
    // A request that fails its schema is a bug on the main thread: the throw ends the worker,
    // and the main thread fails every call still waiting.
    const request = workerRequestSchema.parse(message);
    if (request.kind === "close") {
      context.database.close();
      port.postMessage({ kind: "reply", id: request.id, ok: true, value: null });
      port.close();
      return;
    }
    port.postMessage(handleRequest(context, request));
  });
}

/**
 * Serves one database on this store worker thread: opens the connection its `workerData` names,
 * refuses a schema newer than `definition` knows, then answers requests one at a time, in order.
 * Each database's worker entry calls it once.
 */
export function serveDatabase(definition: DatabaseDefinition): void {
  const port = parentPort;
  if (port === null) {
    throw new BinferenceError({
      code: "store.not_a_worker",
      message:
        "serveDatabase runs only on a store worker thread; open the database with openDatabase.",
    });
  }
  const opened = open(definition, workerSetupSchema.parse(workerData));
  if ("kind" in opened) {
    port.postMessage(opened);
    port.close();
    return;
  }
  port.postMessage(opened.ready);
  serve(port, opened.context);
}
