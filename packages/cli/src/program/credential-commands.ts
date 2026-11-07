import { type Command, InvalidArgumentError, Option, type OptionValues } from "commander";
import { z } from "zod";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

// A credential's name as an environment variable's, or a command line commander refuses.
function nameOf(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    throw new InvalidArgumentError(
      "A credential's name is capitals, digits and underscores, starting with a letter.",
    );
  }
  return value;
}

// Each `--allow-host` adds one host to the list.
function addHost(value: string, earlier: readonly string[] = []): readonly string[] {
  return [...earlier, value];
}

/**
 * Adds the credential commands (decision 0388): `credential list`, `credential set <name>`, whose
 * value comes from a hidden prompt, and `credential delete <name>`.
 */
export function addCredentialCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const credential = program
    .command("credential")
    .description(message("command.credential"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(
    credential.command("list").description(message("command.credentialList")),
    message,
  ).action((flags: OptionValues) =>
    choose({ name: "credentialList", options: commonFlagsSchema.parse(flags) }),
  );
  withCommon(credential.command("set").description(message("command.credentialSet")), message)
    .argument("<name>", message("argument.credential"), nameOf)
    .addOption(new Option("--allow-host <host>", message("option.allowHost")).argParser(addHost))
    .action((name: string, flags: OptionValues) => {
      const hosts = z.array(z.string()).readonly().optional().parse(flags["allowHost"]) ?? [];
      choose({
        name: "credentialSet",
        options: { ...commonFlagsSchema.parse(flags), allowHost: hosts },
        credential: name,
      });
    });
  withCommon(credential.command("delete").description(message("command.credentialDelete")), message)
    .argument("<name>", message("argument.credential"), nameOf)
    .action((name: string, flags: OptionValues) =>
      choose({
        name: "credentialDelete",
        options: commonFlagsSchema.parse(flags),
        credential: name,
      }),
    );
}
