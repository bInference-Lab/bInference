import type { AgentView } from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "./engine-context";

/** The install's agents, archived ones too, oldest first; `undefined` while they load. */
export function useAgents(): readonly AgentView[] | undefined {
  const { client } = useEngine();
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: async ({ signal }) => client.call("agent/list", { limit: 200 }, { signal }),
  });
  return agents.data?.items;
}
