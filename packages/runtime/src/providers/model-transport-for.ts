import type { Clock } from "@binference/core";
import type { RuntimeModels, RuntimeProvider } from "../control/runtime-settings.schema.js";
import type { ModelTransport } from "../loop/ports.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";
import { createMessagesTransport } from "./messages-transport.js";
import type { StreamingHttp } from "./ports.js";

/** What a model transport reaches the network and the time through. */
export interface ProviderParts {
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

function baseUrlOf(provider: RuntimeProvider): string {
  return provider.baseUrl ?? defaultBaseUrls[provider.kind];
}

/**
 * The transport of a role's model under the settings in force (config spec, section 6.3): Chat
 * Completions for the `binference` and `openai` kinds and Messages for the `anthropic` kind, with
 * the provider's key and base URL, and `models.idleTimeoutMs` as the time the provider may take to
 * start its answer. A role with no model and a model whose provider is not configured get a
 * transport that refuses every call as a `request` failure naming why.
 */
export function modelTransportFor(
  models: RuntimeModels,
  role: "main" | "fast",
  parts: ProviderParts,
): ModelTransport {
  const ref = models[role];
  const named = ref === undefined ? undefined : splitModel(ref);
  if (named === undefined) {
    return refusedTransport(`No ${role} model is set as <provider>/<model> in models.${role}.`);
  }
  const provider = models.providers[named.provider];
  if (provider === undefined) {
    return refusedTransport(`The provider of models.${role} is not in models.providers.`);
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
