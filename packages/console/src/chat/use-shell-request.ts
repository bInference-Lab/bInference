import {
  type ProtocolId,
  type ResultOf,
  type ShellAnswer,
  shellPushOf,
  type ShellRequestView,
} from "@binference/protocol";
import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";

/** An answer the owner sends to one request. */
interface ShellAnswerSent {
  readonly request: ShellRequestView;
  readonly answer: ShellAnswer;
}

/** The agent's open shell request, and the owner's answer on its way. */
export interface ShellRequest {
  readonly open?: ShellRequestView;
  readonly answer: UseMutationResult<ResultOf<"shell/answer">, Error, ShellAnswerSent>;
}

function requestKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["shellRequest", agent];
}

/**
 * The agent's open shell request (decision 0409): read with `shell/requests` when the chat opens,
 * again at each request push and after a gap in the agent's chat topic, and the owner's answer
 * through `shell/answer`.
 */
export function useShellRequest(agent: ProtocolId<"agent">): ShellRequest {
  const { client } = useEngine();
  const queries = useQueryClient();
  const key = requestKey(agent);
  const open = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await client.call("shell/requests", { agent }, { signal })).items[0] ?? null,
    retry: false,
  });
  const reload = async (): Promise<void> => queries.invalidateQueries({ queryKey: key });
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      if (shellPushOf(frame) !== undefined) {
        void reload();
      }
    },
    refetch: reload,
  });
  const answer = useMutation({
    mutationFn: async (sent: ShellAnswerSent) =>
      client.call(
        "shell/answer",
        { request: sent.request.request, answer: sent.answer },
        { signal: AbortSignal.timeout(60_000) },
      ),
    onSettled: async () => reload(),
  });
  const shown = open.data ?? undefined;
  return { ...(shown === undefined ? {} : { open: shown }), answer };
}
