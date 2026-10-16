import { ok } from "@binference/core";
import { checkModel, type ModelCheckProblem } from "@binference/runtime";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { isModelAddress, type ModelPreset, modelIdPattern, modelPresets } from "./model-presets.js";
import { type TakenSecret, takeSecret } from "./take-secret.js";

/** The model init links: its provider, the model's id there, and its key. */
export interface ModelLink {
  readonly preset: ModelPreset;
  /** The provider's address, when it is not the API its kind calls by default. */
  readonly baseUrl?: string;
  readonly model: string;
  /** None for a provider that takes no key, such as a local one. */
  readonly key?: TakenSecret;
}

// A model's first answer may take a while on a busy provider or a local machine.
const checkTimeoutMs = 30_000;

/**
 * Checks a model link with one small live call (decision 0221), within 30 seconds; answers what
 * went wrong, or nothing when the model answered.
 */
export async function checkLink(
  context: InitContext,
  link: ModelLink,
): Promise<ModelCheckProblem | undefined> {
  const { host } = context;
  const target = {
    kind: link.preset.kind,
    ...(link.baseUrl === undefined ? {} : { baseUrl: link.baseUrl }),
    ...(link.key === undefined ? {} : { apiKey: link.key.value }),
    model: link.model,
  };
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(checkTimeoutMs)]);
  const parts = { http: host.http, clock: host.clock, timeoutMs: checkTimeoutMs, signal };
  const checked = await checkModel(target, parts);
  return checked.ok ? undefined : checked.error;
}

/** The values a model message names: the provider's words, the model and the address. */
export function linkValues(
  context: InitContext,
  link: ModelLink,
): { readonly provider: string; readonly model: string; readonly address: string } {
  return {
    provider: context.words(`model.provider.${link.preset.id}`),
    model: link.model,
    address: link.baseUrl ?? link.preset.baseUrl ?? context.words(`model.hint.${link.preset.id}`),
  };
}

function presetOfFlag(context: InitContext): InitStep<ModelPreset> {
  const preset = modelPresets.find((item) => item.id === context.flags.modelProvider);
  const providers = modelPresets.map((item) => item.id).join(", ");
  return preset === undefined
    ? refused("init.bad_model_provider", "refused.modelProvider", { providers })
    : ok(preset);
}

function baseUrlOfFlags(context: InitContext, preset: ModelPreset): InitStep<string | undefined> {
  const typed = context.flags.modelBaseUrl;
  if (!preset.asksBaseUrl) {
    return ok(preset.baseUrl);
  }
  if (typed === undefined) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: "--model-base-url" });
  }
  return isModelAddress(typed)
    ? ok(typed)
    : refused("init.bad_model_address", "refused.modelAddress");
}

// A compatible provider may take no key, such as a local one; every other needs `--model-key`.
async function keyOfFlags(
  context: InitContext,
  preset: ModelPreset,
): Promise<InitStep<TakenSecret | undefined>> {
  if (context.flags.modelKey === undefined && preset.asksBaseUrl) {
    return ok(undefined);
  }
  return takeSecret(context, {
    flag: "--model-key",
    flagText: context.flags.modelKey,
    path: `models.providers.${preset.name}.apiKey`,
    question: { id: "modelKey", message: context.words("model.key") },
  });
}

/**
 * The model link the `--model-provider`, `--model`, `--model-base-url` and `--model-key` flags
 * give, the key only as a secret source; nothing when neither of the first two is given. A flag
 * that is missing or does not fit stops init and names it.
 */
export async function linkOfFlags(context: InitContext): Promise<InitStep<ModelLink | undefined>> {
  const { flags } = context;
  if (flags.modelProvider === undefined && flags.model === undefined) {
    return ok(undefined);
  }
  const preset = presetOfFlag(context);
  if (!preset.ok) {
    return preset;
  }
  if (flags.model === undefined || !modelIdPattern.test(flags.model)) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: "--model" });
  }
  const baseUrl = baseUrlOfFlags(context, preset.value);
  if (!baseUrl.ok) {
    return baseUrl;
  }
  const key = await keyOfFlags(context, preset.value);
  if (!key.ok) {
    return key;
  }
  return ok({
    preset: preset.value,
    ...(baseUrl.value === undefined ? {} : { baseUrl: baseUrl.value }),
    model: flags.model,
    ...(key.value === undefined ? {} : { key: key.value }),
  });
}
