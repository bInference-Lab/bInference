import { isDisclaimerPhrase, type MessageValues } from "@binference/i18n";
import type { Prompter } from "./prompter.js";

/** A message of any area by its full key, in the owner's language. */
type Message = (key: string, values?: MessageValues) => string;

/**
 * Shows the disclaimer and the privacy statement of spec 4 section 9, each as a note, and asks
 * the person to type the phrase back, in either language and any letter case. Any other answer
 * shows `wrongKey` and asks again; a person who cancels throws `cli.prompt_cancelled`.
 */
export async function askDisclaimer(
  prompter: Prompter,
  message: Message,
  wrongKey: string,
): Promise<void> {
  const phrase = { phrase: message("disclaimer.phrase") };
  prompter.note(message("disclaimer.text"), message("disclaimer.title"));
  prompter.note(message("disclaimer.privacy"), message("disclaimer.privacyTitle"));
  await prompter.ask({
    id: "disclaimer",
    message: message("disclaimer.ask", phrase),
    check: (answer) => (isDisclaimerPhrase(answer) ? undefined : message(wrongKey, phrase)),
  });
}
