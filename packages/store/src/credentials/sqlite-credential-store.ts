import { createSecret } from "@binference/core";
import type { CredentialStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  getCredentialTask,
  listCredentialsTask,
  purgeCredentialsTask,
  putCredentialTask,
  removeCredentialTask,
  revealCredentialTask,
} from "./credential-tasks.js";

/** Every task of the SQLite credential store. */
export const credentialTasks: readonly TaskRunner[] = [
  listCredentialsTask,
  getCredentialTask,
  revealCredentialTask,
  putCredentialTask,
  removeCredentialTask,
  purgeCredentialsTask,
];

/**
 * The {@link CredentialStore} on `engine.sqlite`: `credentials`, one row per name (decision 0388).
 * Only `credentials.reveal` reads a value back, wrapped in a `Secret` as it arrives.
 */
export function createSqliteCredentialStore(host: StoreHost): CredentialStore {
  const list = bindTask(host, listCredentialsTask);
  const get = bindTask(host, getCredentialTask);
  const reveal = bindTask(host, revealCredentialTask);
  const put = bindTask(host, putCredentialTask);
  const remove = bindTask(host, removeCredentialTask);
  const purge = bindTask(host, purgeCredentialsTask);
  return {
    list: async (options) => list(null, options),
    get: async (name, options) => (await get(name, options)) ?? undefined,
    reveal: async (name, options) => {
      const row = await reveal(name, options);
      return row === null ? undefined : { ...row, value: createSecret(row.value) };
    },
    put: async (credential, options) => {
      await put(credential, options);
    },
    remove: async (name, { atMs, signal }) => remove({ name, atMs }, { signal }),
    purge: async (beforeMs, options) => purge(beforeMs, options),
  };
}
