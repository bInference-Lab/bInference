import type { DatabaseHandle } from "../host/open-database.js";
import type { StoreTask } from "./store-task.js";

/** Where a store adapter sends its tasks: an open database's handle, or a host in a test. */
export type StoreHost = Pick<DatabaseHandle, "run">;

/** A store task bound to its host, called as a port's method is. */
export type BoundTask<Input, Output> = (
  input: Input,
  options: { readonly signal: AbortSignal },
) => Promise<Output>;

/**
 * Binds a store task to a host. A call on an aborted signal rejects with the signal's reason
 * before the task is sent, so it changes nothing.
 */
export function bindTask<Input, Output>(
  host: StoreHost,
  task: StoreTask<Input, Output>,
): BoundTask<Input, Output> {
  return async (input, options) => {
    options.signal.throwIfAborted();
    return host.run(task, input, { signal: options.signal });
  };
}
