import { ok } from "@binference/core";
import type { DisclaimerAcceptance } from "@binference/engine/install";
import type { Locale } from "@binference/protocol";
import type { LayerEntry } from "../config/layers/layer-entry.js";
import { type DisclaimerAnswer, takeDisclaimer } from "./disclaimer-step.js";
import type { EarlierAnswers } from "./earlier-answers.js";
import type { InitContext, InitStep } from "./init-context.js";
import { takeTelemetry } from "./telemetry-step.js";

/** What a run starts with: the language the person picked, and an earlier set-up's answers. */
export interface InitStart {
  /** None when the config takes the flag's or the system's language. */
  readonly locale?: Locale;
  readonly earlier?: EarlierAnswers;
}

/**
 * The answers init takes after the language and before the Privy app, in the order of
 * ARCHITECTURE section 27: the disclaimer and telemetry.
 */
export interface FirstAnswers {
  readonly locale?: Locale;
  readonly disclaimer: DisclaimerAnswer;
  /** The telemetry choice as a config entry, when a person made one. */
  readonly telemetry: readonly LayerEntry[];
}

/**
 * Takes the disclaimer and telemetry; the disclaimer is asked only while the install holds no
 * acceptance of the current text.
 */
export async function takeFirstAnswers(
  context: InitContext,
  start: InitStart & { readonly accepted?: DisclaimerAcceptance },
): Promise<InitStep<FirstAnswers>> {
  const { earlier } = start;
  const disclaimer = await takeDisclaimer(context, start.accepted);
  const telemetry = await takeTelemetry(context, earlier?.telemetry);
  return ok({
    ...(start.locale === undefined ? {} : { locale: start.locale }),
    disclaimer,
    telemetry,
  });
}
