import type { BudgetMemory } from "../helpers/budget-memory.js";
import type { ChatStatusSource } from "../tools/agent-status-tool.js";
import { type AgentStores, written } from "./agent-stores.js";

/** The status sources of one runtime start: the agent's own turns', and its helpers'. */
export interface ChatStatusSources {
  /** Reads the session and sets its chat model. */
  readonly agent: ChatStatusSource;
  /** Reads the session and never sets a model. */
  readonly helper: ChatStatusSource;
}

/**
 * The {@link ChatStatusSource}s over `agent.sqlite` and the budget the engine last answered: the
 * session's start, turns and chat model, and, for the agent's own turns, the chat model's write
 * under the start's fence (decision 0404). A helper's turns get one that never sets a model.
 */
export function createChatStatusSources(parts: {
  readonly stores: AgentStores;
  readonly budgets: BudgetMemory;
}): ChatStatusSources {
  const { stores, budgets } = parts;
  const helper: ChatStatusSource = {
    async read(session, signal) {
      const [stored, turns] = await Promise.all([
        stores.sessions.get(session, { signal }),
        stores.sessions.countTurns(session, { signal }),
      ]);
      return stored === undefined
        ? undefined
        : {
            startedAtMs: stored.startedAtMs,
            turns,
            ...(stored.model === undefined ? {} : { model: stored.model }),
          };
    },
    budgetLeft: (agent) => budgets.leftOf(agent),
  };
  const agent: ChatStatusSource = {
    ...helper,
    async setModel(change, signal) {
      const set = await stores.sessions.setModel({ ...change, fence: stores.fence }, { signal });
      if (!set.ok && set.error !== "fenced") {
        return false;
      }
      written(set, "set the chat's model");
      return true;
    },
  };
  return { agent, helper };
}
