import type { IntentStore } from "../ports.js";
import type { IntentQuery } from "./intent-change.js";
import type { IntentRecord } from "./intent-record.js";

/**
 * Every intent the query lists, a page of `query.limit` at a time, in the store's order: change
 * time, then id. A page shorter than the limit is the last.
 */
export async function everyIntentOf(
  intents: Pick<IntentStore, "list">,
  query: Omit<IntentQuery, "after">,
  call: { readonly signal: AbortSignal; readonly after?: IntentRecord },
): Promise<readonly IntentRecord[]> {
  const { signal, after } = call;
  const paged = {
    ...query,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const page = await intents.list(paged, { signal });
  const last = page.at(-1);
  return page.length < query.limit || last === undefined
    ? page
    : [...page, ...(await everyIntentOf(intents, query, { signal, after: last }))];
}
