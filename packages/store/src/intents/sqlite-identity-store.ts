import type { IdentityStore } from "@binference/engine/sends";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { identityOfTask } from "./identity-rows.js";

/** Every task of the SQLite identity store; the intent store's moves write its rows. */
export const identityTasks: readonly TaskRunner[] = [identityOfTask];

/** The {@link IdentityStore} on `engine.sqlite`: one row of `identities` per agent. */
export function createSqliteIdentityStore(host: StoreHost): IdentityStore {
  return { get: bindTask(host, identityOfTask) };
}
