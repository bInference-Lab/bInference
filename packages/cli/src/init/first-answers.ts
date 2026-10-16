import { ok } from "@binference/core";
import type { DisclaimerAcceptance } from "@binference/engine/install";
import type { Locale } from "@binference/protocol";
import type { LayerEntry } from "../config/layers/layer-entry.js";
import { type DisclaimerAnswer, takeDisclaimer } from "./disclaimer-step.js";
import type { EarlierAnswers } from "./earlier-answers.js";
import type { ModelSettings } from "./init-config.js";
import type { InitContext, InitStep } from "./init-context.js";
import type { ModelLink } from "./model-link.js";
import { takeModel } from "./model-step.js";
import type { SecretPlace } from "./secret-places.js";
import { takeTelemetry } from "./telemetry-step.js";

/** What a run starts with: the language the person picked, and an earlier set-up's answers. */
export interface InitStart {
  /** None when the config takes the flag's or the system's language. */
  readonly locale?: Locale;
  readonly earlier?: EarlierAnswers;
}

/**
 * The answers init takes after the language and before the Privy app, in the order of
 * ARCHITECTURE section 27: the disclaimer, telemetry and the model.
 */
export interface FirstAnswers {
  readonly locale?: Locale;
  readonly disclaimer: DisclaimerAnswer;
  /** The telemetry choice as a config entry, when a person made one. */
  readonly telemetry: readonly LayerEntry[];
  /** None when a run nobody answers names no model. */
  readonly model?: ModelLink;
}

/**
 * Takes the disclaimer, telemetry and the model, each step its own refusal; the disclaimer is
 * asked only while the install holds no acceptance of the current text.
 */
export async function takeFirstAnswers(
  context: InitContext,
  start: InitStart & { readonly accepted?: DisclaimerAcceptance },
): Promise<InitStep<FirstAnswers>> {
  const { earlier } = start;
  const disclaimer = await takeDisclaimer(context, start.accepted);
  const telemetry = await takeTelemetry(context, earlier?.telemetry);
  const model = await takeModel(context, earlier?.model);
  if (!model.ok) {
    return model;
  }
  return ok({
    ...(start.locale === undefined ? {} : { locale: start.locale }),
    disclaimer,
    telemetry,
    ...(model.value === undefined ? {} : { model: model.value }),
  });
}

/** The keychain entry or `keys/` file that holds a model provider's key, by its name. */
export function modelKeyEntry(provider: string): string {
  return `${provider}-key`;
}

/**
 * The model the config names: its provider, address and model, and the key's source: the one a
 * flag or the earlier set-up named, else where init keeps the key the person typed.
 */
export function modelSettingsOf(
  link: ModelLink,
  place: Pick<SecretPlace, "sourceOf">,
): ModelSettings {
  const { preset, key } = link;
  const apiKey =
    key === undefined ? undefined : (key.source ?? place.sourceOf(modelKeyEntry(preset.name)));
  return {
    name: preset.name,
    kind: preset.kind,
    ...(link.baseUrl === undefined ? {} : { baseUrl: link.baseUrl }),
    ...(apiKey === undefined ? {} : { apiKey }),
    model: link.model,
  };
}
