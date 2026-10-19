import { BinferenceError } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { ModelBudget } from "../billing/model-budget.js";

/**
 * Why a wake-up of the agent starts no turn now, if it cannot (decision 0232): an agent that is
 * gone or archived, frozen, or whose model budget of the day is spent. A spent budget tells the
 * owner, at most once that day, as a refused turn does.
 */
export async function wakeSkipOf(
  budget: Pick<ModelBudget, "open">,
  settings: AgentSettings | undefined,
  signal: AbortSignal,
): Promise<"archived" | "frozen" | "budget" | undefined> {
  if (settings === undefined || settings.agent.archivedAtMs !== undefined) {
    return "archived";
  }
  if (settings.agent.frozenAtMs !== undefined) {
    return "frozen";
  }
  try {
    await budget.open(settings, { signal });
    return undefined;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "agent.budget") {
      return "budget";
    }
    throw error;
  }
}
