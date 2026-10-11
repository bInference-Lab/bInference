import type { WriterFence } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { raiseFenceTask } from "./fence-tasks.js";

/** The {@link WriterFence} on `agent.sqlite`. */
export function createSqliteWriterFence(host: StoreHost): WriterFence {
  const raise = bindTask(host, raiseFenceTask);
  return { raise: async (options) => raise(null, options) };
}
