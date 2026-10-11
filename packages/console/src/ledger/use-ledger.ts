import type { ResultOf } from "@binference/protocol";
import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { lastSeq } from "./last-seq";

/** One ledger entry as `ledger/list` answers it. */
export type LedgerEntry = ResultOf<"ledger/list">["items"][number];

/** A page of the newest entries, and the number before its first, from which older ones load. */
export interface LedgerPage {
  readonly entries: readonly LedgerEntry[];
  readonly before: number;
}

// The console shows this many entries at a time.
const pageSize = 50;
// The page parameter of the first page: the newest entries, wherever the ledger ends.
const newest = -1;

/**
 * The ledger from its newest entry back, a page of 50 at a time: the newest page first, then each
 * older one when asked. `ledger/list` pages forward, so the newest entry's number is found first.
 */
export function useLedger(): UseInfiniteQueryResult<InfiniteData<LedgerPage, number>> {
  const { client } = useEngine();
  const read = async (after: number, limit: number, signal: AbortSignal) =>
    (await client.call("ledger/list", { cursor: String(after), limit }, { signal })).items;
  return useInfiniteQuery({
    queryKey: ["ledger"],
    initialPageParam: newest,
    queryFn: async ({ pageParam, signal }): Promise<LedgerPage> => {
      const end =
        pageParam === newest
          ? await lastSeq(async (after, limit) => (await read(after, limit, signal)).length)
          : pageParam;
      const before = Math.max(0, end - pageSize);
      const entries = end === 0 ? [] : await read(before, end - before, signal);
      return { entries: entries.toReversed(), before };
    },
    getNextPageParam: (page) => (page.before > 0 ? page.before : undefined),
  });
}
