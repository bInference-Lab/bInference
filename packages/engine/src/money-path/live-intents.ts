import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentQuery } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";

// The intents a page reads at a time.
const pageSize = 50;

/**
 * Every live intent in the query's states, of the query's agent when it names one, the least
 * recently changed first: it reads page after page, so no number of intents hides the last ones.
 */
export async function liveIntentsIn(
  stored: Pick<StoredIntents, "list">,
  query: Pick<IntentQuery, "states" | "agentId">,
  signal: AbortSignal,
): Promise<readonly IntentRecord[]> {
  const read: IntentRecord[] = [];
  let after: IntentQuery["after"];
  for (;;) {
    const page: IntentQuery = { ...query, isPaper: false, limit: pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last
    const found = await stored.list(after === undefined ? page : { ...page, after }, { signal });
    read.push(...found);
    const last = found.at(-1);
    if (last === undefined || found.length < pageSize) {
      return read;
    }
    after = { changedAtMs: last.changedAtMs, id: last.id };
  }
}
