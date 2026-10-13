import { type Clock, createDeadline, type Id } from "@binference/core";
import type { IntentState } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { fillOrderOf } from "./fill-ends.js";

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
  const { isPaper, agentId, order } = query;
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
  const fills = read.filter((snapshot): snapshot is IntentSnapshot => {
    const owner = snapshot === undefined ? undefined : fillOrderOf(snapshot);
    return owner !== undefined && (order === undefined || owner === order);
  });
  const last = listed.at(-1);
  if (listed.length < pageSize || last === undefined) {
    return fills;
  }
  const next = { changedAtMs: last.changedAtMs, id: last.id };
  return [...fills, ...(await unfinishedFills(stored, query, { signal, after: next }))];
}

// The states of a live fill the executor holds: confirmed, then signing, sending and settling.
const unsettledLive: readonly IntentState[] = [
  "confirmed",
  "executing",
  "included",
  "finalized",
  "unknown_after_send",
];

/**
 * Whether an agent has a live order fill the executor has not settled (decision 0210): one
 * confirmed and waiting for its wallet's queue, signing, sent or settling. The agent's fills wait
 * behind it, after a restart too, so two exit fills of one position never run at once (spec 6,
 * invariant 11) and an order never fills again before its fill is recorded.
 */
export async function hasUnsettledLiveFill(
  stored: StoredIntents,
  agentId: Id<"agt">,
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const { signal } = call;
  const query = { states: unsettledLive, isPaper: false, agentId, limit: pageSize };
  const listed = await stored.list(query, { signal });
  const engines = listed.filter(({ proposer }) => proposer === "engine");
  const read = await Promise.all(engines.map(async ({ id }) => stored.snapshot(id, { signal })));
  return read.some((snapshot) => snapshot !== undefined && fillOrderOf(snapshot) !== undefined);
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
