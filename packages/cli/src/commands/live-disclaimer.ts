import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { CommandRun } from "../program/command-run.js";

// The phrase in either language is taken, in any case and with spaces around it.
function phrasesOf(run: CommandRun): readonly string[] {
  const own = run.formatter.message("cli.live.phrase");
  return [own, "I understand"].map((phrase) => phrase.toLowerCase());
}

/**
 * Shows the disclaimer and the privacy statement before an agent goes live (decision 0060), and
 * asks the person at the terminal to type the phrase back: "I understand", or its words in the
 * owner's language. A wrong answer asks again; a person who cancels stays in paper mode. Nobody
 * at the terminal, `--yes` or `--json` is refused, so no script goes live unread. Answers whether
 * the owner accepted.
 */
export async function acceptDisclaimer(run: CommandRun, options: CommonOptions): Promise<boolean> {
  const { prompter } = run.host;
  const phrase = run.formatter.message("cli.live.phrase");
  if (prompter === undefined || options.yes || options.json) {
    run.output.fail({ code: "agent.disclaimer", key: "live.needsTerminal", values: { phrase } });
    return false;
  }
  const message = (key: string): string => run.formatter.message(`cli.${key}`, { phrase });
  prompter.note(message("live.disclaimer"), message("live.disclaimerTitle"));
  const phrases = phrasesOf(run);
  await prompter.ask({
    id: "disclaimer",
    message: message("live.ask"),
    check: (answer) =>
      phrases.includes(answer.trim().toLowerCase()) ? undefined : message("live.wrongPhrase"),
  });
  return true;
}
