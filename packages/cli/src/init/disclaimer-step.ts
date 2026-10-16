import type { DisclaimerAcceptance } from "@binference/engine/install";
import { disclaimerVersion } from "@binference/i18n";
import { askDisclaimer } from "../term/disclaimer-question.js";
import type { InitContext } from "./init-context.js";

/**
 * Where the disclaimer stands after its step: the person typed the phrase now (`accepted`), the
 * install holds an acceptance of the current text (`accepted_before`), or nobody was at a
 * terminal to read it (`not_accepted`), so `binference live` asks before any agent goes live.
 */
export type DisclaimerAnswer = "accepted" | "accepted_before" | "not_accepted";

/**
 * The disclaimer step, after the language (spec 4, section 9; decision 0220): shows the
 * disclaimer and the privacy statement, and the person types the phrase back, in either language.
 * An install that accepted the current text before is told when, and not asked again. A run
 * nobody answers shows nothing and says that going live asks for it.
 */
export async function takeDisclaimer(
  context: InitContext,
  stored: DisclaimerAcceptance | undefined,
): Promise<DisclaimerAnswer> {
  const { prompter } = context;
  if (stored !== undefined && stored.version >= disclaimerVersion) {
    prompter.say(
      context.words("disclaimer.earlier", { date: context.dateTime(stored.acceptedAtMs) }),
    );
    return "accepted_before";
  }
  if (!context.isInteractive) {
    prompter.say(context.words("disclaimer.unread"));
    return "not_accepted";
  }
  await askDisclaimer(prompter, context.message, "init.disclaimer.wrongPhrase");
  prompter.say(context.words("disclaimer.accepted"));
  return "accepted";
}
