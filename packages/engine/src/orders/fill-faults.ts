import type { Id } from "@binference/core";
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
