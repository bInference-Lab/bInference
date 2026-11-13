import type { IdempotencyStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { finishTask, forgetTask, pruneIdempotencyTask, startTask } from "./idempotency-tasks.js";

/** The {@link IdempotencyStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteIdempotencyStore(host: StoreHost): IdempotencyStore {
  return {
    start: bindTask(host, startTask),
    finish: bindTask(host, finishTask),
    forget: bindTask(host, forgetTask),
    prune: bindTask(host, pruneIdempotencyTask),
  };
}
