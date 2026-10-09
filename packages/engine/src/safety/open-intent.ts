import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { intentStates, isTerminalState } from "../intents/intent-state.js";
import type { IntentStore } from "../ports.js";

const openStates = intentStates.filter((state) => !isTerminalState(state));
const pageSize = 1_000;

/** Which open intent to find: its kind, and what else it must hold. */
export interface OpenIntentQuery {
  readonly kind: IntentKind;
  readonly matches?: (record: IntentRecord) => boolean;
}

/**
 * The least recently changed intent of a kind that has not ended and that the query matches, or
 * `undefined` when none has, read a page of open intents at a time.
 */
export async function openIntentOf(
  intents: IntentStore,
  query: OpenIntentQuery,
  call: { readonly signal: AbortSignal; readonly after?: IntentRecord },
): Promise<IntentRecord | undefined> {
  const { signal, after } = call;
  const listed = {
    states: openStates,
    limit: pageSize,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const page = await intents.list(listed, { signal });
  const found = page.find(
    (record) => record.kind === query.kind && (query.matches?.(record) ?? true),
  );
  const last = page.at(-1);
  return found !== undefined || page.length < pageSize || last === undefined
    ? found
    : openIntentOf(intents, query, { signal, after: last });
}
