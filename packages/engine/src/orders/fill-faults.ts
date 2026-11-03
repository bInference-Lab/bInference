import { type AssetRef, assetRefParts, type ChainRegistry } from "@binference/chain";
import { type Clock, createDeadline, type Id } from "@binference/core";
import type { IntentState } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentStore } from "../ports.js";
import { fillOrderOf } from "./fill-ends.js";
import type { OrderRecord } from "./order-record.js";
import { isTriggerDisarmed } from "./price-triggers.js";

// The states a fill passes through before its authorization confirms it.
const beforeConfirmed: readonly IntentState[] = [
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
];

const pageSize = 100;

/** Which unfinished fills to read: of one agent or all, in one mode, of one order or any. */
export interface UnfinishedQuery {
  readonly isPaper: boolean;
  readonly agentId?: Id<"agt">;
  readonly order?: Id<"ord">;
  /** Which fills to keep in place of the auto orders', such as a webhook rule's (decision 0338). */
  readonly isFill?: (snapshot: IntentSnapshot) => boolean;
}

// Whether an intent is an auto order's fill, of the order the query names when it names one.
function isOrderFill(query: UnfinishedQuery, snapshot: IntentSnapshot): boolean {
  const owner = fillOrderOf(snapshot);
  return owner !== undefined && (query.order === undefined || owner === query.order);
}

/**
 * The auto order fills left unfinished, the least recently changed first (decision 0197): those
 * before their confirmation, and a paper one confirmed but not filled. A live fill once confirmed
 * is the executor's, and never among them.
 */
export async function unfinishedFills(
  stored: StoredIntents,
  query: UnfinishedQuery,
  call: {
    readonly signal: AbortSignal;
    readonly after?: { readonly changedAtMs: number; readonly id: Id<"int"> };
  },
): Promise<readonly IntentSnapshot[]> {
  const { isPaper, agentId } = query;
  const isFill = query.isFill ?? ((snapshot: IntentSnapshot) => isOrderFill(query, snapshot));
  const { signal, after } = call;
  const states = isPaper ? [...beforeConfirmed, "confirmed" as const] : beforeConfirmed;
  const listed = await stored.list(
    {
      states,
      isPaper,
      limit: pageSize,
      ...(agentId === undefined ? {} : { agentId }),
      ...(after === undefined ? {} : { after }),
    },
    { signal },
  );
  const engines = listed.filter(({ proposer }) => proposer === "engine");
  const read = await Promise.all(engines.map(async ({ id }) => stored.snapshot(id, { signal })));
  const fills = read.filter(
    (snapshot): snapshot is IntentSnapshot => snapshot !== undefined && isFill(snapshot),
  );
  const last = listed.at(-1);
  if (listed.length < pageSize || last === undefined) {
    return fills;
  }
  const next = { changedAtMs: last.changedAtMs, id: last.id };
  return [...fills, ...(await unfinishedFills(stored, query, { signal, after: next }))];
}

/** How many blocks the executor watches a dropped step's transactions (spec 6, section 6). */
const droppedWatchBlocks = 600;

/**
 * How long a dropped live fill's transactions stay watched, so its agent's line stays held: 600
 * blocks of its chain from the drop (decision 0211). A chain the registry does not list holds
 * for a day.
 */
function droppedWatchMs(chains: ChainRegistry, token: AssetRef): number {
  const chain = chains.get(assetRefParts(token).chain);
  return chain.ok ? droppedWatchBlocks * chain.value.definition.blockTimeMs : 86_400_000;
}

/** An auto order or a webhook rule as its line of fills reads it: its agent, mode and token. */
export interface LineHolder {
  readonly agentId: Id<"agt">;
  readonly isPaper: boolean;
  readonly request: { readonly token: AssetRef };
}

/**
 * The live fills of an order's or rule's agent that hold its line (decisions 0210, 0211 and 0342):
 * those the executor holds that their order or alert has not counted, and those whose dropped step
 * is still watched. The store answers every such fill, with no page limit, so it holds after a
 * stop too, and two exit fills of one position never run at once (spec 6, invariant 11). A paper
 * holder never waits behind one, and reads none.
 */
export async function fillsHoldingLine(
  parts: {
    readonly intents: Pick<IntentStore, "fillsInFlight">;
    readonly chains: ChainRegistry;
    readonly clock: Clock;
  },
  holder: LineHolder,
  signal: AbortSignal,
): Promise<readonly IntentRecord[]> {
  if (holder.isPaper) {
    return [];
  }
  const watchMs = droppedWatchMs(parts.chains, holder.request.token);
  const droppedSinceMs = Math.max(0, parts.clock.now() - watchMs);
  return parts.intents.fillsInFlight({ agentId: holder.agentId, droppedSinceMs }, { signal });
}

/** How long a fill has, from its start in its agent's line to its end (decision 0197). */
const fillDeadlineMs = 30_000;

/**
 * Runs a fill on a signal that aborts at its deadline, and rejects with the deadline's reason once
 * it passes, whether or not the fill's step watches its signal: a stuck step never holds the
 * agent's line. A store call the stuck step makes later fails on the aborted signal.
 */
export async function withinDeadline<T>(
  call: { readonly clock: Clock; readonly signal: AbortSignal },
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = createDeadline({ ...call, timeoutMs: fillDeadlineMs });
  const listening = new AbortController();
  const passed = new Promise<never>((_resolve, reject) => {
    deadline.signal.addEventListener(
      "abort",
      () => {
        reject(deadline.signal.reason);
      },
      { once: true, signal: listening.signal },
    );
  });
  try {
    deadline.signal.throwIfAborted();
    return await Promise.race([work(deadline.signal), passed]);
  } finally {
    listening.abort();
    deadline.clear();
  }
}

/**
 * Whether a live order's agent has a live fill that holds the line (decision 0211): one in flight,
 * or one dropped and still watched. A paper order never waits behind one.
 */
export async function isLineHeld(
  parts: {
    readonly intents: Pick<IntentStore, "fillsInFlight">;
    readonly chains: ChainRegistry;
    readonly clock: Clock;
  },
  order: OrderRecord,
  signal: AbortSignal,
): Promise<boolean> {
  return (await fillsHoldingLine(parts, order, signal)).length > 0;
}

/**
 * Whether an order may start a fill: active, before its expiry, and armed as stored, so a trigger
 * that judged an older copy, before a fill disarmed it, fires nothing (decision 0197).
 */
export function canFire(
  parts: { readonly clock: Clock },
  order: OrderRecord | undefined,
): order is OrderRecord {
  return (
    order?.state === "active" &&
    parts.clock.now() < order.expiresAtMs &&
    !isTriggerDisarmed(order.triggerState)
  );
}
