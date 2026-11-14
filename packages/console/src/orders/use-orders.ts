import type { ProtocolClient } from "@binference/client";
import type { AssetInfos, OrderState, OrderView, ProtocolId, ResultOf } from "@binference/protocol";
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

/** Which orders a list holds: those still open, or those that ended. */
export type OrderList = "open" | "ended";

/** Where the next page starts: the state of the list's states it reads, and its cursor there. */
interface OrderCursor {
  readonly state: number;
  readonly cursor?: string;
}

/** One page of a list: orders in the list's state order, the info of their tokens, and the next. */
export interface OrderPage {
  readonly items: readonly OrderView[];
  readonly assets: AssetInfos;
  readonly next?: OrderCursor;
}

// The states each list reads, in the order it shows them.
const listStates: Readonly<Record<OrderList, readonly OrderState[]>> = {
  open: ["awaiting_confirmation", "active", "paused"],
  ended: ["filled", "cancelled", "expired", "ended"],
};

// A page holds at most this many orders, read from as many states as it takes to fill it.
const pageSize = 50;
const callMs = 30_000;
// The first page reads the list's first state from its start.
const firstPage: OrderCursor = { state: 0 };

/** What a page is read with. */
interface PageCall {
  readonly client: ProtocolClient;
  readonly states: readonly OrderState[];
  readonly signal: AbortSignal;
}

// Reads `order/list` state after state from `at`, until the page is full or every state is read.
async function pageFrom(call: PageCall, at: OrderCursor, got: OrderPage): Promise<OrderPage> {
  const state = call.states[at.state];
  if (state === undefined) {
    return got;
  }
  const args = {
    state,
    limit: pageSize - got.items.length,
    ...(at.cursor === undefined ? {} : { cursor: at.cursor }),
  };
  const answer = await call.client.call("order/list", args, { signal: call.signal });
  const page = {
    items: [...got.items, ...answer.items],
    assets: { ...got.assets, ...answer.assets },
  };
  if (answer.next !== undefined) {
    return { ...page, next: { state: at.state, cursor: answer.next } };
  }
  const following = { state: at.state + 1 };
  if (page.items.length < pageSize) {
    return pageFrom(call, following, page);
  }
  return call.states[following.state] === undefined ? page : { ...page, next: following };
}

/**
 * The orders of a list, open or ended, live and paper, a page of 50 at a time: by state, as the
 * list orders its states, then oldest first, as `order/list` pages them. A push on the `order` or
 * the `intent` topic loads them again.
 */
export function useOrderPages(
  list: OrderList,
): UseInfiniteQueryResult<InfiniteData<OrderPage, OrderCursor>> {
  const { client } = useEngine();
  return useInfiniteQuery({
    queryKey: ["orders", list],
    initialPageParam: firstPage,
    queryFn: async ({ pageParam, signal }) =>
      pageFrom({ client, states: listStates[list], signal }, pageParam, { items: [], assets: {} }),
    getNextPageParam: (page) => page.next,
  });
}

/** One order with its newest fills and skips, newest first, read when it is asked for. */
export function useOrderFills(order: ProtocolId<"autoOrder">): UseQueryResult<OrderView> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["orders", "get", order],
    queryFn: async ({ signal }) => client.call("order/get", { order }, { signal }),
  });
}

/**
 * `order/cancel` (`propose`): the order ends at once, with no card, on every surface, and a card it
 * waits on closes. The engine answers the order as it ended, or refuses with its code.
 */
export function useCancelOrder(): UseMutationResult<
  ResultOf<"order/cancel">,
  Error,
  ProtocolId<"autoOrder">
> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (order) =>
      client.call("order/cancel", { order }, { signal: AbortSignal.timeout(callMs) }),
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: ["orders"] });
      await queries.invalidateQueries({ queryKey: ["intents"] });
    },
  });
}
