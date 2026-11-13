import type { LimitField } from "@binference/i18n";
import type { LimitChanges, LimitsView, ProtocolId } from "@binference/protocol";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** One limit the owner changes, and the change `limit/set` takes. */
export interface LimitChange {
  readonly field: LimitField;
  readonly changes: LimitChanges;
}

const callMs = 30_000;

function useReload(agent: ProtocolId<"agent">): () => Promise<void> {
  const queries = useQueryClient();
  return async () => queries.invalidateQueries({ queryKey: ["limits", agent] });
}

/**
 * `limit/set` for one limit of the agent (decision 0111): `confirm` when it is stricter, which
 * applies at once, `loosen` otherwise, which waits 24 hours; the engine decides which. It answers
 * the limits in effect and those that wait.
 */
export function useLimitChange(
  agent: ProtocolId<"agent">,
): UseMutationResult<LimitsView, Error, LimitChange> {
  const { client } = useEngine();
  const reload = useReload(agent);
  return useMutation({
    mutationFn: async ({ changes }) =>
      client.call("limit/set", { agent, changes }, { signal: AbortSignal.timeout(callMs) }),
    onSettled: reload,
  });
}

/** `limit/cancelPending` (`confirm`): drops the looser limits that wait; those in effect stay. */
export function useCancelPending(
  agent: ProtocolId<"agent">,
): UseMutationResult<LimitsView, Error, void> {
  const { client } = useEngine();
  const reload = useReload(agent);
  return useMutation({
    mutationFn: async () =>
      client.call("limit/cancelPending", { agent }, { signal: AbortSignal.timeout(callMs) }),
    onSettled: reload,
  });
}
