import type { CardCopyStore } from "@binference/engine/surfaces";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { findCardCopiesTask, intentCardCopiesTask, keepCardCopyTask } from "./card-copy-tasks.js";

/** Every task of the SQLite card copy store. */
export const cardCopyTasks: readonly TaskRunner[] = [
  keepCardCopyTask,
  findCardCopiesTask,
  intentCardCopiesTask,
];

/**
 * The {@link CardCopyStore} on `engine.sqlite`: each Telegram copy in `card_messages`, under the
 * card version its callback reference names, so a card shown before a restart still becomes its
 * receipt after it (decision 0139).
 */
export function createSqliteCardCopyStore(host: StoreHost): CardCopyStore {
  const keep = bindTask(host, keepCardCopyTask);
  return {
    keep: async (copy, options) => {
      await keep(copy, options);
    },
    find: bindTask(host, findCardCopiesTask),
    ofIntent: bindTask(host, intentCardCopiesTask),
  };
}
