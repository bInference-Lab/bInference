import type { WalletStore } from "@binference/engine/wallets";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { listWalletsTask } from "./wallet-tasks.js";

/** Every task of the SQLite wallet store. */
export const walletTasks: readonly TaskRunner[] = [listWalletsTask];

/** The {@link WalletStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteWalletStore(host: StoreHost): WalletStore {
  return { list: bindTask(host, listWalletsTask) };
}
