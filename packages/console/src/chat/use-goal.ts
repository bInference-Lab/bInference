import {
  chatDeletedPushOf,
  type GoalAction,
  goalPushOf,
  type GoalRead,
  type ProtocolId,
} from "@binference/protocol";
import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";

/** The open chat's goal and progress note, and the owner's change of the goal on its way. */
export interface ChatGoal {
  readonly read: GoalRead;
  readonly change: UseMutationResult<GoalRead, Error, GoalAction>;
}

function goalKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["goal", agent];
}

/**
 * The open chat's goal and progress note (decision 0407): read with `goal/get` when the chat
 * opens, again at each `chat/goal` and `chat/deleted` push and after a gap in the agent's chat
 * topic, and the owner's pause, resume or clear through `goal/change`.
 */
export function useGoal(agent: ProtocolId<"agent">): ChatGoal {
  const { client } = useEngine();
  const queries = useQueryClient();
  const key = goalKey(agent);
  const read = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => client.call("goal/get", { agent }, { signal }),
    retry: false,
  });
  const reload = async (): Promise<void> => queries.invalidateQueries({ queryKey: key });
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      if (goalPushOf(frame) !== undefined || chatDeletedPushOf(frame) !== undefined) {
        void reload();
      }
    },
    refetch: reload,
  });
  const change = useMutation({
    mutationFn: async (action: GoalAction) =>
      client.call("goal/change", { agent, action }, { signal: AbortSignal.timeout(60_000) }),
    onSettled: async () => reload(),
  });
  return { read: read.data ?? {}, change };
}
