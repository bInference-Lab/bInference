import type { MessagePort } from "node:worker_threads";
import type { DatabaseDefinition } from "../databases/database-definition.js";
import { createTaskBridge } from "../postgres/bridge-connection.js";
import {
  type EndedMessage,
  type PostgresTaskSetup,
  type RunMessage,
  type ServingMessage,
  toTaskThreadSchema,
} from "../postgres/task-bridge-messages.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { taskNamed, tasksByName } from "./handle-request.js";
import { toWorkerError } from "./worker-error.js";
import type { WorkerValue } from "./worker-messages.schema.js";

function runTask(
  run: RunMessage,
  task: () => TaskRunner,
  bridge: ReturnType<typeof createTaskBridge>,
): EndedMessage {
  try {
    const value = task().handle(bridge.connectionFor(run.run, run.schema), run.input);
    return { kind: "ended", run: run.run, ok: true, value };
  } catch (error) {
    return { kind: "ended", run: run.run, ok: false, error: toWorkerError(error) };
  }
}

/**
 * Serves a database's store tasks on Postgres from this thread (decision 0369): each run's task
 * runs synchronously here, while the thread that sent it runs each statement in the run's
 * transaction. Runs come one at a time; an answer left from an earlier run is dropped.
 */
export function servePostgresTasks(
  port: MessagePort,
  definition: DatabaseDefinition,
  setup: PostgresTaskSetup,
): void {
  const tasks = tasksByName(definition);
  const bridge = createTaskBridge({
    port,
    words: new Int32Array(setup.words),
    waitMs: setup.waitMs,
  });
  port.on("message", (value: WorkerValue) => {
    // A message that fails its schema is a bug on the statement side: the throw ends the thread,
    // and every run still waiting there fails.
    const message = toTaskThreadSchema.parse(value);
    if (message.kind === "stop") {
      port.close();
    } else if (message.kind === "run") {
      const task = (): TaskRunner => taskNamed(tasks, definition, message.task);
      port.postMessage(runTask(message, task, bridge), []);
    }
  });
  const serving: ServingMessage = { kind: "serving", database: definition.name };
  port.postMessage(serving, []);
}
