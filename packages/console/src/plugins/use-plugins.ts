import type { ProtocolId, ResultOf } from "@binference/protocol";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** An installed plugin as `plugin/list` answers it. */
export type PluginView = ResultOf<"plugin/list">["items"][number];

/** What a switch asks: one plugin turned on or off. */
export interface PluginSwitch {
  readonly plugin: ProtocolId<"installedPlugin">;
  readonly on: boolean;
}

// A switch waits for the plugin's start to settle, which the engine answers after.
const callMs = 30_000;

/** The installed plugins, as the plugin lock holds them now. */
export function usePlugins(): UseQueryResult<readonly PluginView[]> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["plugins"],
    queryFn: async ({ signal }) => (await client.call("plugin/list", {}, { signal })).items,
  });
}

/**
 * `plugin/enable` (`admin`) or `plugin/disable` (`confirm`), then the plugins again. The engine
 * answers the plugin as it stands once its start settled, so an enable the host refused answers
 * it off (decision 0348).
 */
export function useSwitchPlugin(): UseMutationResult<PluginView, Error, PluginSwitch> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async ({ plugin, on }) =>
      client.call(
        on ? "plugin/enable" : "plugin/disable",
        { plugin },
        { signal: AbortSignal.timeout(callMs) },
      ),
    onSettled: async () => queries.invalidateQueries({ queryKey: ["plugins"] }),
  });
}
