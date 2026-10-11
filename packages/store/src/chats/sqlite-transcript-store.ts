import type { TranscriptStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { appendCommittingTask, appendEventsTask, listEventsTask } from "./transcript-tasks.js";

/** The {@link TranscriptStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteTranscriptStore(host: StoreHost): TranscriptStore {
  return {
    append: bindTask(host, appendEventsTask),
    appendCommitting: bindTask(host, appendCommittingTask),
    events: bindTask(host, listEventsTask),
  };
}
