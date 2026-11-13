import type { CreatedIntent, CreatedQuery } from "../intents/created-intent.js";
import { byCreation } from "./memory-call.js";
import type { MemoryIntentTables } from "./memory-intent-tables.js";

/**
 * One agent's intents stored at or after the query's time, as the SQLite store reads them: the
 * first stored first, then by id.
 */
export function createdSince(
  tables: Pick<MemoryIntentTables, "intents">,
  query: CreatedQuery,
): readonly CreatedIntent[] {
  return tables
    .intents()
    .filter((intent) => intent.agentId === query.agentId && intent.createdAtMs >= query.fromMs)
    .toSorted(byCreation)
    .map(({ id, kind, proposer, createdAtMs }) => ({ intentId: id, kind, proposer, createdAtMs }));
}
