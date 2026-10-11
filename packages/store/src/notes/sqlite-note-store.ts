import type { NoteStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { deleteNoteTask, listNotesTask, searchNotesTask, writeNoteTask } from "./note-tasks.js";

/** The {@link NoteStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteNoteStore(host: StoreHost): NoteStore {
  return {
    write: bindTask(host, writeNoteTask),
    delete: bindTask(host, deleteNoteTask),
    list: bindTask(host, listNotesTask),
    search: bindTask(host, searchNotesTask),
  };
}
