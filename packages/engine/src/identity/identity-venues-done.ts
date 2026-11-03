import type { IdentityRegistry } from "@binference/chain/identity";
import type { Id } from "@binference/core";
import type { IdentityStore } from "./ports.js";

/**
 * The venues an agent's ceilings need no more (decision 0335): the identity registries, once
 * binference holds the agent's identity, since an agent registers once; none before. A ceiling
 * planned again for the agent, by `ceiling set` or a destination save, leaves them out.
 */
export function identityVenuesDone(parts: {
  readonly identities: IdentityStore;
  readonly registries: readonly IdentityRegistry[];
}): (agent: Id<"agt">, options: { readonly signal: AbortSignal }) => Promise<readonly string[]> {
  return async (agent, options) =>
    (await parts.identities.get(agent, options)) === undefined
      ? []
      : parts.registries.map((registry) => registry.id);
}
