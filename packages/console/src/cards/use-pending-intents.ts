import type { IntentView } from "@binference/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/**
 * The intents whose card waits for the owner, oldest first, up to 50: one query for every screen
 * that shows cards, which a push on the `intent` topic loads again.
 */
export function usePendingIntents(): UseQueryResult<readonly IntentView[]> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["intents", "awaiting_confirmation"],
    queryFn: async ({ signal }) => {
      const page = await client.call(
        "intent/list",
        { state: "awaiting_confirmation", limit: 50 },
        { signal },
      );
      return page.items.filter((intent) => intent.card !== undefined);
    },
  });
}
