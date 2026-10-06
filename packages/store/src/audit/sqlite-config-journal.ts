import type { ConfigJournal } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { listChangesTask, recordChangeTask } from "./config-journal-tasks.js";

/** The {@link ConfigJournal} on `engine.sqlite`: each call runs one store task. */
export function createSqliteConfigJournal(host: StoreHost): ConfigJournal {
  return { record: bindTask(host, recordChangeTask), list: bindTask(host, listChangesTask) };
}
