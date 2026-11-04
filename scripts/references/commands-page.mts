import type { Formatter, MessageValues } from "@binference/i18n";
import { commandReference, type ReferenceCommand, type ReferenceTerm } from "binference";
import { code, type ReferencePage, sentence, separator } from "./reference-page.mjs";

const commonOptions = [
  ["--json", "option.json"],
  ["--yes", "option.yes"],
  ["-h, --help", "option.help"],
] as const;

function termLine(term: ReferenceTerm, formatter: Formatter): string {
  const facts = [
    ...(term.isRequired ? [formatter.message("docs.commands.required")] : []),
    ...(term.choices === undefined
      ? []
      : [
          formatter.message("docs.commands.choices", {
            choices: term.choices.map(code).join(", "),
          }),
        ]),
  ];
  const text = [sentence(term.description, formatter), ...facts].join(separator(formatter));
  return `- ${code(term.term)}: ${text}`;
}

function termList(label: string, terms: readonly ReferenceTerm[], formatter: Formatter): string[] {
  return terms.length === 0
    ? []
    : [formatter.message(label), "", ...terms.map((term) => termLine(term, formatter)), ""];
}

// A subcommand sits a heading level below its parent, down to the fourth.
function commandSection(command: ReferenceCommand, formatter: Formatter): string {
  const depth = Math.min(command.name.split(" ").length + 1, 4);
  return [
    `${"#".repeat(depth)} ${code(`binference ${command.name}`)}`,
    "",
    sentence(command.description, formatter),
    "",
    ...termList("docs.commands.arguments", command.arguments, formatter),
    ...termList("docs.commands.options", command.options, formatter),
  ].join("\n");
}

function render(formatter: Formatter): string {
  const cli = (key: string, values?: MessageValues): string =>
    formatter.message(`cli.${key}`, values);
  const intro = formatter.message("docs.commands.intro", {
    help: code("binference <command> --help"),
  });
  const common = commonOptions.map(
    ([term, key]) => `- ${code(term)}: ${sentence(cli(key), formatter)}`,
  );
  const commands = commandReference(cli).map((command) => commandSection(command, formatter));
  return [intro, "", ...common, "", ...commands].join("\n");
}

/** The reference of every `binference` command, from the program's own command tree. */
export const commandsPage: ReferencePage = { name: "commands", file: "commands", render };
