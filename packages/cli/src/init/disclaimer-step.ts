import type { DisclaimerAcceptance } from "@binference/engine/install";
import { disclaimerVersion } from "@binference/i18n";
import { askDisclaimer } from "../term/disclaimer-question.js";
import type { InitContext } from "./init-context.js";

/**
 * Where the disclaimer stands after its step: the person typed the phrase now, or a run nobody
 * answers printed it and its flag accepted it (`accepted`), the install holds an acceptance of
 * the current text (`accepted_before`), or nobody accepted it (`not_accepted`), so
 * `binference live` asks before any agent goes live.
 */
export type DisclaimerAnswer = "accepted" | "accepted_before" | "not_accepted";

// The disclaimer and the privacy statement in full, before the flag accepts them. With `--json`
// they go to standard error, which a script's JSON answer leaves free.
function printDisclaimer(context: InitContext): void {
  const { message, prompter } = context;
  const notes = [
    [message("disclaimer.title"), message("disclaimer.text")],
    [message("disclaimer.privacyTitle"), message("disclaimer.privacy")],
  ] as const;
  for (const [title, text] of notes) {
    if (context.flags.json) {
      context.host.err(`${title}\n${text}\n`);
    } else {
      prompter.note(text, title);
    }
  }
}

/**
 * The disclaimer step, after the language (spec 4, section 9; decision 0220): shows the
 * disclaimer and the privacy statement, and the person types the phrase back, in either language.
 * An install that accepted the current text before is told when, and not asked again. A run
 * nobody answers accepts only with `--accept-disclaimer`, and prints both texts in full first
 * (decision 0223); without it, it says that going live asks for them.
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
    if (!context.flags.acceptDisclaimer) {
      prompter.say(context.words("disclaimer.unread"));
      return "not_accepted";
    }
    printDisclaimer(context);
    prompter.say(context.words("disclaimer.acceptedPrinted"));
    return "accepted";
  }
  await askDisclaimer(prompter, context.message, "init.disclaimer.wrongPhrase");
  prompter.say(context.words("disclaimer.accepted"));
  return "accepted";
}
