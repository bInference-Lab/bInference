import type { IntentView, ProtocolId } from "@binference/protocol";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useEngine } from "../connection/engine-context";
import { usePendingIntents } from "./use-pending-intents";

/** The cards a screen shows: those that wait for the owner, and those that closed since. */
export interface CardCopies {
  /** The cards that wait, oldest first; none while they load. */
  readonly waiting?: readonly IntentView[];
  /** The cards that closed while the page showed them, newest first, each with its receipt. */
  readonly closed: readonly IntentView[];
  readonly error: Error | null;
}

// The most closed cards a page keeps; an older one leaves the page.
const mostClosed = 20;

// The intents that waited, and those that left the waiting list since, newest first.
interface Seen {
  readonly waiting: readonly ProtocolId<"intent">[];
  readonly closed: readonly ProtocolId<"intent">[];
}

function sameIds(
  left: readonly ProtocolId<"intent">[],
  right: readonly ProtocolId<"intent">[],
): boolean {
  return left.length === right.length && left.every((id, at) => id === right[at]);
}

/**
 * The cards a screen shows (decision 0346): those that wait for the owner, and each card the page
 * showed waiting that closed since, as `intent/get` reads it with the line its copies end with,
 * until a reload. An intent push loads both again, as every `intents` query.
 */
export function useCardCopies(): CardCopies {
  const { client } = useEngine();
  const pending = usePendingIntents();
  const [seen, setSeen] = useState<Seen>({ waiting: [], closed: [] });
  const ids = pending.data?.map(({ intent }) => intent);
  // Kept from the render before, as React keeps state from earlier renders: a card that left the
  // waiting list closed.
  if (ids !== undefined && !sameIds(ids, seen.waiting)) {
    const left = seen.waiting.filter((id) => !ids.includes(id));
    const closed = [...left, ...seen.closed.filter((id) => !ids.includes(id))];
    setSeen({ waiting: ids, closed: closed.slice(0, mostClosed) });
  }
  const read = useQueries({
    queries: seen.closed.map((intent) => ({
      queryKey: ["intents", "get", intent],
      queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
        client.call("intent/get", { intent }, { signal }),
    })),
  });
  const closed = read.flatMap(({ data }) => (data === undefined ? [] : [data]));
  return {
    ...(pending.data === undefined ? {} : { waiting: pending.data }),
    closed,
    error: pending.error,
  };
}
