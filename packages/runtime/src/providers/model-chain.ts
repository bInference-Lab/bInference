import type { Clock } from "@binference/core";
import type { ModelChain } from "../loop/ports.js";
import type { ChainModel } from "../loop/turn-records.js";

/** The rests of the runtime's providers, which every turn's chain shares. */
export interface ProviderRests {
  readonly clock: Clock;
  /** `models.cooldownMs` in the settings in force. */
  readonly cooldownMs: number;
  /** When each resting provider's rest ends, in epoch milliseconds, by the provider's name. */
  readonly until: Map<string, number>;
}

// `<provider>/<model>`: the provider's name ends at the first slash.
function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return slash <= 0 ? model : model.slice(0, slash);
}

/**
 * A {@link ModelChain} over the given models, never empty, whose providers rest in the shared
 * `rests`: a rest covers every model of its provider, for the cooldown or the longer wait the
 * provider asked for.
 */
export function createModelChain(
  models: readonly [ChainModel, ...ChainModel[]],
  rests: ProviderRests,
): ModelChain {
  return {
    models,
    resting: (model) => (rests.until.get(providerOf(model)) ?? 0) > rests.clock.now(),
    rest(model, atLeastMs) {
      const until = rests.clock.now() + Math.max(rests.cooldownMs, atLeastMs);
      const provider = providerOf(model);
      rests.until.set(provider, Math.max(rests.until.get(provider) ?? 0, until));
    },
  };
}
