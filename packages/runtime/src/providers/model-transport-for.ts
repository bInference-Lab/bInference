import type { Clock } from "@binference/core";
import type { RuntimeModels, RuntimeProvider } from "../control/runtime-settings.schema.js";
import type { ModelChain, ModelTransport } from "../loop/ports.js";
import { modelPriceOf } from "../usage/model-price.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";
import { createMessagesTransport } from "./messages-transport.js";
import { createModelChain } from "./model-chain.js";
import type { StreamingHttp } from "./ports.js";

/** What a model transport reaches the network and the time through. */
interface ProviderParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

/** The binference AI gateway, which the `binference` kind calls when it names no base URL. */
export const binferenceGatewayUrl = "https://binference.io/api/v1";

/** The API each kind calls when the provider names no base URL. */
const defaultBaseUrls: Readonly<Record<RuntimeProvider["kind"], string>> = {
  binference: binferenceGatewayUrl,
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

/** A transport whose every call ends at once as a refused request, naming why. */
function refusedTransport(message: string): ModelTransport {
  return {
    async *stream() {
      yield { type: "error", failure: "request", message } as const;
    },
  };
}

// `<provider>/<model>`: the provider's name ends at the first slash, and the model's id, which may
// hold slashes of its own (`anthropic/claude-sonnet-4.5`), is the rest.
function splitModel(
  ref: string,
): { readonly provider: string; readonly model: string } | undefined {
  const slash = ref.indexOf("/");
  return slash <= 0 || slash === ref.length - 1
    ? undefined
    : { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/** The provider's base URL, or the API its kind calls when it names none. */
export function baseUrlOf(provider: Pick<RuntimeProvider, "kind" | "baseUrl">): string {
  return provider.baseUrl ?? defaultBaseUrls[provider.kind];
}

/** How the settings name a model of a chain, for the words of a call refused for its sake. */
interface ModelPlace {
  /** The model is missing or not `<provider>/<model>`. */
  readonly unnamed: string;
  /** Its provider is not configured. */
  readonly unknown: string;
}

function placesOf(role: "main" | "fast"): {
  readonly own: ModelPlace;
  readonly fallback: ModelPlace;
} {
  return {
    own: {
      unnamed: `No ${role} model is set as <provider>/<model> in models.${role}.`,
      unknown: `The provider of models.${role} is not in models.providers.`,
    },
    fallback: {
      unnamed: `A model in models.fallbacks.${role} is not set as <provider>/<model>.`,
      unknown: `The provider of a model in models.fallbacks.${role} is not in models.providers.`,
    },
  };
}

const pickedPlace: ModelPlace = {
  unnamed: "The agent's model is not set as <provider>/<model>.",
  unknown: "The provider of the agent's model is not in models.providers.",
};

// The transport of one model under the settings in force: Chat Completions for the `binference`
// and `openai` kinds and Messages for the `anthropic` kind, with the provider's key and base URL,
// and `models.idleTimeoutMs` as the time the provider may take to start its answer. A model that is
// missing or whose provider is not configured gets a transport that refuses every call as a
// `request` failure naming why.
function transportOf(
  models: RuntimeModels,
  model: { readonly ref: string | undefined; readonly place: ModelPlace },
  parts: ProviderParts,
): ModelTransport {
  const named = model.ref === undefined ? undefined : splitModel(model.ref);
  if (named === undefined) {
    return refusedTransport(model.place.unnamed);
  }
  const provider = models.providers[named.provider];
  if (provider === undefined) {
    return refusedTransport(model.place.unknown);
  }
  const options = {
    baseUrl: baseUrlOf(provider),
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
    model: named.model,
    timeoutMs: models.idleTimeoutMs,
    ...parts,
  };
  return provider.kind === "anthropic"
    ? createMessagesTransport(options)
    : createChatCompletionsTransport(options);
}

/** What a chain's transports reach the network and the time through, and the providers' rests. */
export interface ChainParts extends ProviderParts {
  /** When each resting provider's rest ends, shared by every turn of the runtime. */
  readonly rests: Map<string, number>;
}

/**
 * The chain of a role under the settings in force (config spec, section 6.3; runtime spec,
 * section 8.2): the role's model, then `models.fallbacks.<role>` in order, each with its own
 * transport and its price (section 8.3), resting its provider for `models.cooldownMs`. A model the owner picked for the agent
 * stands alone and is never swapped for another.
 */
export function modelChainFor(
  models: RuntimeModels,
  which: { readonly role: "main" | "fast"; readonly picked?: string },
  parts: ChainParts,
): ModelChain {
  const { role, picked } = which;
  const places = placesOf(role);
  const own =
    picked === undefined
      ? { ref: models[role], place: places.own }
      : { ref: picked, place: pickedPlace };
  const fallbacks =
    picked === undefined
      ? models.fallbacks[role].map((ref) => ({ ref, place: places.fallback }))
      : [];
  const transportParts = { http: parts.http, clock: parts.clock };
  const chainModel = (model: { readonly ref: string | undefined; readonly place: ModelPlace }) => {
    const priced = model.ref === undefined ? undefined : modelPriceOf(model.ref, models);
    const reads = model.ref !== undefined && models.imageInput.includes(model.ref);
    return {
      name: model.ref ?? `${role}/none`,
      transport: transportOf(models, model, transportParts),
      ...(priced === undefined ? {} : { price: priced.price }),
      ...(reads ? { readsImages: true as const } : {}),
    };
  };
  return createModelChain([chainModel(own), ...fallbacks.map(chainModel)], {
    clock: parts.clock,
    cooldownMs: models.cooldownMs,
    until: parts.rests,
  });
}

const visionPlace: ModelPlace = {
  unnamed: "models.vision is not set as <provider>/<model>.",
  unknown: "The provider of models.vision is not in models.providers.",
};

/**
 * The vision model's chain (decision 0227): the model the owner picked for the agent's vision
 * role, else `models.vision`, alone, which reads images by its role. `undefined` when neither
 * names one.
 */
export function visionChainFor(
  models: RuntimeModels,
  picked: string | undefined,
  parts: ChainParts,
): ModelChain | undefined {
  const ref = picked ?? models.vision;
  if (ref === undefined) {
    return undefined;
  }
  const place = picked === undefined ? visionPlace : pickedPlace;
  const priced = modelPriceOf(ref, models);
  const model = {
    name: ref,
    transport: transportOf(models, { ref, place }, { http: parts.http, clock: parts.clock }),
    ...(priced === undefined ? {} : { price: priced.price }),
    readsImages: true as const,
  };
  return createModelChain([model], {
    clock: parts.clock,
    cooldownMs: models.cooldownMs,
    until: parts.rests,
  });
}
