import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ModelChain } from "../loop/ports.js";
import { isConfiguredModel } from "../providers/model-ref.js";
import {
  type ChainParts,
  modelChainFor,
  visionChainFor,
} from "../providers/model-transport-for.js";
import type { TurnPlace } from "../sessions/turn-place.js";

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
 * The session's chat model when the settings in force still configure its provider; one whose
 * provider is gone is ignored, so the turn runs on the configured chain (decision 0404).
 */
export function chatModelOf(
  place: Pick<TurnPlace, "chatModel">,
  settings: Pick<RuntimeSettings, "models">,
): string | undefined {
  const { chatModel } = place;
  const providers = Object.keys(settings.models.providers);
  return chatModel !== undefined && isConfiguredModel(chatModel, providers) ? chatModel : undefined;
}

/**
 * The chains an agent's next turn runs on under the settings in force: the session's chat model
 * (decision 0404), else the model the owner picked for the agent, each standing alone and never
 * swapped (decision 0204), else the main model; for compaction the fast model, the main one when
 * no fast model is set (decision 0202), each with the agent's pick for that role; and the vision
 * model, the agent's pick or `models.vision`.
 */
export function turnModelsOf(
  place: { readonly agent: string; readonly chatModel?: string },
  settings: Pick<RuntimeSettings, "models">,
  parts: ChainParts,
): TurnModels {
  const { models } = settings;
  const picks = models.picked?.[place.agent] ?? {};
  const summaryRole = models.fast === undefined && picks.fast === undefined ? "main" : "fast";
  const pickOf = (role: "main" | "fast") => {
    const picked = role === "main" ? (chatModelOf(place, settings) ?? picks.main) : picks.fast;
    return picked === undefined ? { role } : { role, picked };
  };
  const vision = visionChainFor(models, picks.vision, parts);
  return {
    main: modelChainFor(models, pickOf("main"), parts),
    summarizer: modelChainFor(models, pickOf(summaryRole), parts),
    ...(vision === undefined ? {} : { vision }),
  };
}
