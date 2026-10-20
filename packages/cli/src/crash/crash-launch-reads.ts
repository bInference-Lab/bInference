import { chainRefSchema } from "@binference/chain";
import { evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { idSchema } from "@binference/core";
import { intentStates } from "@binference/engine";
import { createSqlitePositionStore } from "@binference/store";
import type { CrashLauncher } from "./crash-launches.js";
import { crashUsdtAsset } from "./crash-orders.js";
import { withStore } from "./crash-reads.js";

const bscRef = chainRefSchema.parse(bsc.id);

/** What the engine's store holds of a run's launch, as the next engine reads it. */
export interface StoredLaunchRun {
  /** The launch intents of the agent: one, or none when the launch was never stored. */
  readonly launches: number;
  /** The launch's state. */
  readonly state: string | undefined;
  /** The states the launch moved through, the first first. */
  readonly path: readonly string[];
  /** The launch's cards, each by the reason it closed, `open` while it is open. */
  readonly cards: readonly string[];
  /** The keys of the owner's notices about the launch, the oldest first. */
  readonly notices: readonly string[];
  /** The launch feed's records of tokens the launch wallet made. */
  readonly feed: number;
  /** The launch wallet's live executions, and its units of each asset but USDT. */
  readonly executions: number;
  readonly held: readonly bigint[];
}

const allStates = [...intentStates];

/** Reads what the store at `folder` holds of the launcher's launch, its feed record and holding. */
export async function storedLaunchOf(
  folder: string,
  launcher: CrashLauncher,
): Promise<StoredLaunchRun> {
  const walletId = idSchema("wal").parse(launcher.wallet);
  const creator = evmAccountRef(evmChainOf(bsc), launcher.address);
  return withStore(folder, async (stores, signal, database) => {
    const intents = await stores.intents.list({ states: allStates, limit: 50 }, { signal });
    const launches = intents.filter((intent) => intent.kind === "launchToken");
    const [launch] = launches;
    const events = launch === undefined ? [] : await stores.intents.events(launch.id, { signal });
    const cards = launch === undefined ? [] : await stores.intents.cards(launch.id, { signal });
    const notices = await stores.notices.list({ limit: 100 }, { signal });
    const feed = await stores.launches.list({ chain: bscRef, limit: 50 }, { signal });
    const positions = createSqlitePositionStore(database);
    const page = { after: 0, limit: 50, isPaper: false, walletId };
    const executions = await positions.executions(page, { signal });
    const held = await positions.positions({ walletId, isPaper: false }, { signal });
    return {
      launches: launches.length,
      state: launch?.state,
      path: events.map(({ toState }) => toState),
      cards: cards.map((card) => card.closeReason ?? "open"),
      notices: notices
        .filter(({ notice }) => launch !== undefined && notice.intent === launch.id)
        .map(({ notice }) => notice.key),
      feed: feed.filter((item) => item.creator === creator).length,
      executions: executions.length,
      held: held
        .filter(({ asset }) => asset !== crashUsdtAsset)
        .map(({ quantityBase }) => quantityBase),
    };
  });
}
