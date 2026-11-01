import type { Id } from "@binference/core";
import type { ConfigAuthor } from "../audit/journal-config-change.js";
import {
  announceRewrite,
  type CeilingRewriteParts,
  type HeldCeiling,
} from "../ceilings/ceiling-rewrite.js";
import type { AgentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";

// The ceilings of one agent's wallets among those read.
function own(held: readonly HeldCeiling[], agent: Id<"agt">): readonly HeldCeiling[] {
  return held.filter((item) => item.wallet.agentId === agent);
}

/**
 * Journals and announces, agent by agent, a rewrite of the ceilings of several agents' wallets, as
 * a rescue address change makes: each agent's wallets read before and after, with the notices of
 * its rescue address standings that changed (decision 0321).
 */
export async function announceEachAgent(
  parts: Pick<CeilingRewriteParts, "journal" | "publish" | "chains" | "clock"> & {
    readonly agents: AgentStore;
  },
  moved: {
    readonly author: ConfigAuthor;
    readonly signal: AbortSignal;
    readonly notices: ReadonlyMap<Id<"agt">, readonly EnginePush[]>;
  },
  reads: { readonly before: readonly HeldCeiling[]; readonly after: readonly HeldCeiling[] },
): Promise<void> {
  const { author, signal, notices } = moved;
  const agents = [...new Set(reads.after.map((held) => held.wallet.agentId))];
  for (const agentId of agents) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each agent's change is journaled in turn
    const settings = await parts.agents.get(agentId, { signal });
    if (settings !== undefined) {
      const each = { before: own(reads.before, agentId), after: own(reads.after, agentId) };
      const also = notices.get(agentId) ?? [];
      // oxlint-disable-next-line eslint/no-await-in-loop -- each agent's change is journaled in turn
      await announceRewrite(parts, { agent: settings.agent, author, signal, also }, each);
    }
  }
}
