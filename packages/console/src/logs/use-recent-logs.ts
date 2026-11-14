import type { LogLineView, RecentLogView } from "@binference/protocol";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** A level of the engine log. */
export type LogLevel = LogLineView["level"];

// The lines a page reads: the newest the engine keeps for one call (decision 0446).
const pageLines = 200;

/**
 * The engine log's newest lines at `level` or above, as `log/recent` answers them; it needs
 * `admin`, so only a screen of a connection that holds it reads them.
 */
export function useRecentLogs(level: LogLevel): UseQueryResult<RecentLogView> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["logs", level],
    queryFn: async ({ signal }) =>
      client.call("log/recent", { level, limit: pageLines }, { signal }),
  });
}
