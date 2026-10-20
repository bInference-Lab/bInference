import type { IntentQuery } from "@binference/engine";
import { fileSize } from "@binference/platform";
import { createSqliteEngineStores, engineWorker, openDatabase } from "@binference/store";
import { connectEngine } from "../commands/connect-engine.js";
import { platformOf } from "../compose/engine-locations.js";
import type { CliHost } from "../program/cli-host.js";

/** Whether a live trade is being sent, or `unreadable` when `engine.sqlite` cannot say. */
export type LiveTrade = "sending" | "none" | "unreadable";

// The page an engine answers: enough to see one live intent among paper ones.
const executingPage = 200;
// One live intent in `executing` is enough to answer.
const sendingQuery: IntentQuery = { states: ["executing"], isPaper: false, limit: 1 };

/**
 * Asks the running engine whether an intent of a live agent is `executing`. An engine that does
 * not answer says nothing here: the check of `engine.sqlite` once it stopped decides.
 */
export async function isLiveTradeAnswered(host: CliHost, signal: AbortSignal): Promise<boolean> {
  const connection = await connectEngine(host, signal);
  if (!connection.ok) {
    return false;
  }
  try {
    const page = await connection.client.call(
      "intent/list",
      { state: "executing", limit: executingPage },
      { signal },
    );
    return page.items.some((intent) => !intent.paper);
  } catch {
    return false;
  } finally {
    connection.client.close();
  }
}

/**
 * Reads `engine.sqlite` with the engine stopped: `sending` while a live intent is `executing`, its
 * transaction perhaps still on its way, `none` when none is or there is no database, and
 * `unreadable` when the database does not open or answer.
 */
export async function liveTradeStored(host: CliHost, signal: AbortSignal): Promise<LiveTrade> {
  const file = platformOf(host).stateFolder.engineDatabase;
  if (!(await fileSize(file, signal)).ok) {
    return "none";
  }
  try {
    const database = await openDatabase({
      file,
      worker: engineWorker,
      readers: 0,
      execArgv: host.workerExecArgv ?? [],
      signal,
    });
    try {
      const stores = createSqliteEngineStores(database);
      const sending = await stores.intents.list(sendingQuery, { signal });
      return sending.length > 0 ? "sending" : "none";
    } finally {
      await database.close();
    }
  } catch {
    return "unreadable";
  }
}
