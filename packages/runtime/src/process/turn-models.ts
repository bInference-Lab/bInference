import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ModelChain } from "../loop/ports.js";
import {
  type ChainParts,
  modelChainFor,
  visionChainFor,
} from "../providers/model-transport-for.js";

/**
 * The model chains of one agent's turn: its talking model, the one that writes summaries, and the
 * one that describes images when the talking model takes none, when one is set.
 */
export interface TurnModels {
  readonly main: ModelChain;
  readonly summarizer: ModelChain;
  readonly vision?: ModelChain;
}

/**
 * The chains an agent's next turn runs on under the settings in force: the main model, or the one
 * the owner picked for the agent, which stands alone and is never swapped (decision 0204); and for
 * compaction the fast model, the main one when no fast model is set (decision 0202), each with the
 * agent's pick for that role; and the vision model, the agent's pick or `models.vision`.
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
  const vision = visionChainFor(models, picks.vision, parts);
  return {
    main: modelChainFor(models, pickOf("main"), parts),
    summarizer: modelChainFor(models, pickOf(summaryRole), parts),
    ...(vision === undefined ? {} : { vision }),
  };
}
