import type { TranscriptStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { appendEventsTask, listEventsTask } from "./transcript-tasks.js";

/** The {@link TranscriptStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteTranscriptStore(host: StoreHost): TranscriptStore {
  return {
    append: bindTask(host, appendEventsTask),
    events: bindTask(host, listEventsTask),
  };
}
