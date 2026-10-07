import type { TransactionStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  listSendsTask,
  recordFinalTask,
  recordReceiptTask,
  recordReorgTask,
  recordSendTask,
} from "./transaction-progress-tasks.js";
import { listTransactionsTask, nextNonceTask, saveSignedTask } from "./transaction-tasks.js";

/** Every task of the SQLite transaction store. */
export const transactionTasks: readonly TaskRunner[] = [
  nextNonceTask,
  saveSignedTask,
  listTransactionsTask,
  recordSendTask,
  listSendsTask,
  recordReceiptTask,
  recordFinalTask,
  recordReorgTask,
];

/**
 * The {@link TransactionStore} on `engine.sqlite`: each call runs one store task, and the one writer
 * runs a nonce decision and its write, or a transaction's move and its relay answers, in one
 * transaction.
 */
export function createSqliteTransactionStore(host: StoreHost): TransactionStore {
  return {
    nextNonce: bindTask(host, nextNonceTask),
    saveSigned: bindTask(host, saveSignedTask),
    list: bindTask(host, listTransactionsTask),
    recordSend: bindTask(host, recordSendTask),
    sends: bindTask(host, listSendsTask),
    recordReceipt: bindTask(host, recordReceiptTask),
    recordFinal: bindTask(host, recordFinalTask),
    recordReorg: bindTask(host, recordReorgTask),
  };
}
