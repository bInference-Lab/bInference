import type { TransactionStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  listSendsTask,
  recordFinalTask,
  recordReceiptTask,
  recordReorgTask,
  recordSendTask,
  recordSupersededTask,
} from "./transaction-progress-tasks.js";
import {
  intentTransactionsTask,
  listTransactionsTask,
  nextNonceTask,
  saveReplacementTask,
  saveSignedTask,
} from "./transaction-tasks.js";

/** Every task of the SQLite transaction store. */
export const transactionTasks: readonly TaskRunner[] = [
  nextNonceTask,
  saveSignedTask,
  saveReplacementTask,
  listTransactionsTask,
  intentTransactionsTask,
  recordSendTask,
  listSendsTask,
  recordReceiptTask,
  recordFinalTask,
  recordSupersededTask,
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
    saveReplacement: bindTask(host, saveReplacementTask),
    list: bindTask(host, listTransactionsTask),
    ofIntent: bindTask(host, intentTransactionsTask),
    recordSend: bindTask(host, recordSendTask),
    sends: bindTask(host, listSendsTask),
    recordReceipt: bindTask(host, recordReceiptTask),
    recordFinal: bindTask(host, recordFinalTask),
    recordSuperseded: bindTask(host, recordSupersededTask),
    recordReorg: bindTask(host, recordReorgTask),
  };
}
