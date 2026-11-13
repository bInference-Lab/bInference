import type { ResultOf } from "@binference/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** What `safety/status` reads: the freezes, the breaker, the rescue and the rescue address. */
export type SafetyStatus = ResultOf<"safety/status">;

/**
 * The install's safety as `safety/status` reads it (decision 0128): the owner's freeze of the
 * install and of each agent with its time, the breaker while it holds (decision 0441), the rescue
 * that has not ended, and the rescue address with a change that waits. A notice or an intent push
 * loads it again, since a freeze, an unfreeze and a rescue each send both.
 */
export function useSafetyStatus(): UseQueryResult<SafetyStatus> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["safety"],
    queryFn: async ({ signal }) => client.call("safety/status", {}, { signal }),
  });
}
