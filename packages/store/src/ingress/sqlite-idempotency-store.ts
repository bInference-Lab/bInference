import type { IdempotencyStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { pruneIdempotencyTask, recallTask, rememberTask } from "./idempotency-tasks.js";

/** The {@link IdempotencyStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteIdempotencyStore(host: StoreHost): IdempotencyStore {
  return {
    recall: bindTask(host, recallTask),
    remember: bindTask(host, rememberTask),
    prune: bindTask(host, pruneIdempotencyTask),
  };
}
