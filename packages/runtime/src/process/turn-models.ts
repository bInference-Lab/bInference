import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ModelChain } from "../loop/ports.js";
import { type ChainParts, modelChainFor } from "../providers/model-transport-for.js";

/** The model chains of one agent's turn: its talking model, and the one that writes summaries. */
export interface TurnModels {
  readonly main: ModelChain;
  readonly summarizer: ModelChain;
}

/**
 * The chains an agent's next turn runs on under the settings in force: the main model, or the one
 * the owner picked for the agent, which stands alone and is never swapped (decision 0204); and for
 * compaction the fast model, the main one when no fast model is set (decision 0202), each with the
 * agent's pick for that role.
 */
export function turnModelsOf(
  agent: string,
  settings: Pick<RuntimeSettings, "models">,
  parts: ChainParts,
): TurnModels {
  const { models } = settings;
  const picks = models.picked?.[agent] ?? {};
  const summaryRole = models.fast === undefined && picks.fast === undefined ? "main" : "fast";
  const pickOf = (role: "main" | "fast") => {
    const picked = picks[role];
    return picked === undefined ? { role } : { role, picked };
  };
  return {
    main: modelChainFor(models, pickOf("main"), parts),
    summarizer: modelChainFor(models, pickOf(summaryRole), parts),
  };
}
