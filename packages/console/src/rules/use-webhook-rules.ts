import type { ProtocolId, ResultOf } from "@binference/protocol";
import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** Every rule active or awaiting its card, as `webhookRule/list` answers them. */
export type RulePage = ResultOf<"webhookRule/list">;

/** One page of a rule's alerts, newest first, as `webhookRule/events` answers it. */
export type EventPage = ResultOf<"webhookRule/events">;

// The console shows this many alerts of a rule at a time.
const eventPageSize = 20;
// The page parameter of the first page: the newest alerts, with no cursor.
const newest = "";
const callMs = 30_000;

/** The rules active or awaiting their card, which a push on the `intent` or `ledger` topic reloads. */
export function useWebhookRules(): UseQueryResult<RulePage> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["webhookRules"],
    queryFn: async ({ signal }) => client.call("webhookRule/list", {}, { signal }),
  });
}

/** A rule's alerts, the newest page first, then each older one when asked. */
export function useRuleEvents(
  rule: ProtocolId<"webhookRule">,
): UseInfiniteQueryResult<InfiniteData<EventPage, string>> {
  const { client } = useEngine();
  return useInfiniteQuery({
    queryKey: ["webhookRules", "events", rule],
    initialPageParam: newest,
    queryFn: async ({ pageParam, signal }) =>
      client.call(
        "webhookRule/events",
        { rule, limit: eventPageSize, ...(pageParam === newest ? {} : { cursor: pageParam }) },
        { signal },
      ),
    getNextPageParam: (page) => page.next,
  });
}

/** Gives a rule a new URL, shown this once; the old one gets `404` at once. */
export function useRotateRule(): UseMutationResult<
  ResultOf<"webhookRule/rotateUrl">,
  Error,
  ProtocolId<"webhookRule">
> {
  const { client } = useEngine();
  return useMutation({
    mutationFn: async (rule) =>
      client.call("webhookRule/rotateUrl", { rule }, { signal: AbortSignal.timeout(callMs) }),
  });
}

/** Deletes a rule; its URL gets `404` at once, and a card it waits on is cancelled. */
export function useDeleteRule(): UseMutationResult<object, Error, ProtocolId<"webhookRule">> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (rule) =>
      client.call("webhookRule/delete", { rule }, { signal: AbortSignal.timeout(callMs) }),
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: ["webhookRules"] });
      await queries.invalidateQueries({ queryKey: ["intents"] });
    },
  });
}
