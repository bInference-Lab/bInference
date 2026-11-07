import { credentialPushes, type ProtocolId, type ResultOf } from "@binference/protocol";
import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";

/** The agent's open request for a credential, as the engine reads it. */
export type CredentialRequestView = credentialPushes.CredentialRequestView;

/** What the owner sends: a value and the hosts kept, or a skip. */
type CredentialReply =
  | { readonly kind: "store"; readonly value: string; readonly allowedHosts: readonly string[] }
  | { readonly kind: "skip" };

/** A reply the owner sends to one request. */
interface CredentialSent {
  readonly request: CredentialRequestView;
  readonly reply: CredentialReply;
}

/** The agent's open request, and the owner's reply on its way. */
export interface CredentialRequest {
  readonly open?: CredentialRequestView;
  readonly reply: UseMutationResult<ResultOf<"credential/answer">, Error, CredentialSent>;
}

function requestKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["credentialRequest", agent];
}

/**
 * The agent's open credential request (decision 0388): read with `chat/openCredentialRequest`
 * when the chat opens, again at each request push and after a gap in the agent's chat topic, and
 * the owner's reply through `credential/answer` or `credential/skip`. The value goes only in the
 * reply's call, never into the page's state or a query's cache.
 */
export function useCredentialRequest(agent: ProtocolId<"agent">): CredentialRequest {
  const { client } = useEngine();
  const queries = useQueryClient();
  const key = requestKey(agent);
  const open = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await client.call("chat/openCredentialRequest", { agent }, { signal })).request ?? null,
    retry: false,
  });
  const reload = async (): Promise<void> => queries.invalidateQueries({ queryKey: key });
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      if (credentialPushes.credentialPushOf(frame) !== undefined) {
        void reload();
      }
    },
    refetch: reload,
  });
  const reply = useMutation({
    mutationFn: async (sent: {
      readonly request: CredentialRequestView;
      readonly reply: CredentialReply;
    }) => {
      const signal = AbortSignal.timeout(60_000);
      const request = sent.request.request;
      return sent.reply.kind === "store"
        ? client.call(
            "credential/answer",
            { agent, request, value: sent.reply.value, allowedHosts: sent.reply.allowedHosts },
            { signal },
          )
        : client.call("credential/skip", { agent, request }, { signal });
    },
    onSettled: async () => reload(),
  });
  const shown = open.data ?? undefined;
  return { ...(shown === undefined ? {} : { open: shown }), reply };
}
