import type { ProtocolId, ResultOf } from "@binference/protocol";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** What a freeze or an unfreeze names: one agent, or every agent and the install when absent. */
export interface BrakeScope {
  readonly agent?: ProtocolId<"agent">;
  /** The agent's name, as the page shows it. */
  readonly name?: string;
}

// A brake's call waits at most this long, as a card's answer does.
const callMs = 30_000;

// What a brake changes: the safety state, each agent's freeze, and the cards it cancels or opens.
const changedKeys = [["safety"], ["agents"], ["intents"]] as const;

function useReload(): () => Promise<void> {
  const queries = useQueryClient();
  return async () => {
    await Promise.all(changedKeys.map(async (queryKey) => queries.invalidateQueries({ queryKey })));
  };
}

function argsOf(scope: BrakeScope): { readonly agent?: ProtocolId<"agent"> } {
  return scope.agent === undefined ? {} : { agent: scope.agent };
}

/**
 * `safety/freeze` for one agent or every agent (`confirm`): it takes effect on the call, from
 * any surface (ARCHITECTURE.md rule 11), and answers when.
 */
export function useFreeze(): UseMutationResult<ResultOf<"safety/freeze">, Error, BrakeScope> {
  const { client } = useEngine();
  const reload = useReload();
  return useMutation({
    mutationFn: async (scope) =>
      client.call("safety/freeze", argsOf(scope), { signal: AbortSignal.timeout(callMs) }),
    onSettled: reload,
  });
}

/**
 * `safety/unfreeze` for one agent or every agent (`loosen`, decision 0128): it unfreezes nothing
 * on the call, and answers the unfreeze card that waits for the owner's tap, or none when nothing
 * is frozen.
 */
export function useUnfreeze(): UseMutationResult<ResultOf<"safety/unfreeze">, Error, BrakeScope> {
  const { client } = useEngine();
  const reload = useReload();
  return useMutation({
    mutationFn: async (scope) =>
      client.call("safety/unfreeze", argsOf(scope), { signal: AbortSignal.timeout(callMs) }),
    onSettled: reload,
  });
}

/**
 * `safety/rescue` (`confirm`, decision 0044): the rescue card of every agent wallet, or the
 * rescue that has not ended (decision 0125).
 */
export function useRescue(): UseMutationResult<ResultOf<"safety/rescue">, Error, void> {
  const { client } = useEngine();
  const reload = useReload();
  return useMutation({
    mutationFn: async () =>
      client.call("safety/rescue", {}, { signal: AbortSignal.timeout(callMs) }),
    onSettled: reload,
  });
}
