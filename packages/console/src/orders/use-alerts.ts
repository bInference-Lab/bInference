import type { ProtocolClient } from "@binference/client";
import type { AlertView, AssetInfos, PriceCondition, ProtocolId } from "@binference/protocol";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

const callMs = 30_000;
// An agent keeps at most 50 active alerts; the console reads this many pages of 50 at most.
const maxPages = 20;

/** Where the next page of alerts starts, and what the pages before it held. */
interface AlertsSoFar {
  readonly items: readonly AlertView[];
  readonly pages: number;
  readonly cursor?: string;
}

// Every active alert, page after page, oldest first, as `alert/list` pages them.
async function activeAlerts(
  call: { readonly client: ProtocolClient; readonly signal: AbortSignal },
  got: AlertsSoFar = { items: [], pages: 0 },
): Promise<readonly AlertView[]> {
  const { cursor } = got;
  const args = { state: "active" as const, ...(cursor === undefined ? {} : { cursor }) };
  const page = await call.client.call("alert/list", args, { signal: call.signal });
  const items = [...got.items, ...page.items];
  const pages = got.pages + 1;
  return page.next === undefined || pages >= maxPages
    ? items
    : activeAlerts(call, { items, pages, cursor: page.next });
}

/** The active alerts of every agent, which a push on the `alert` topic loads again. */
export function useAlerts(): UseQueryResult<readonly AlertView[]> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["alerts"],
    queryFn: async ({ signal }) => activeAlerts({ client, signal }),
  });
}

// The tokens the alerts name: a price alert's, and a wallet alert's when it names one.
function alertAssets(alerts: readonly AlertView[]): readonly PriceCondition["asset"][] {
  const named = alerts.flatMap(({ condition }) => {
    if (condition.kind === "price") {
      return [condition.asset];
    }
    return condition.kind === "wallet" && condition.asset !== undefined ? [condition.asset] : [];
  });
  return [...new Set(named)];
}

/**
 * The info of each token the alerts name, as `asset/get` answers it: the registry's, or what a
 * token the registry does not list answered on chain, unverified. A token it cannot read is left
 * out, and its alert names it by its short address.
 */
export function useAlertAssets(alerts: readonly AlertView[]): AssetInfos {
  const { client } = useEngine();
  const answers = useQueries({
    queries: alertAssets(alerts).map((asset) => ({
      queryKey: ["assets", asset],
      queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
        client.call("asset/get", { asset }, { signal }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  return Object.fromEntries(
    answers.flatMap(({ data }) => (data === undefined ? [] : [[data.asset, data]])),
  );
}

/** `alert/delete` (`propose`): the alert ends at once and never fires again. */
export function useDeleteAlert(): UseMutationResult<object, Error, ProtocolId<"alert">> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (alert) =>
      client.call("alert/delete", { alert }, { signal: AbortSignal.timeout(callMs) }),
    onSettled: async () => queries.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
