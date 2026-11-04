import { createFormatter, type MessageValues } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { commandReference } from "./command-reference.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const message = (key: string, values?: MessageValues): string =>
  english.message(`cli.${key}`, values);

describe("commandReference", () => {
  const commands = commandReference(message);
  const named = (name: string) => commands.find((command) => command.name === name);

  it("lists each command once, each subcommand after its parent, and no help command", () => {
    const names = commands.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.indexOf("wallet")).toBeLessThan(names.indexOf("wallet create"));
    expect(names.filter((name) => /(?:^| )help$/u.test(name))).toStrictEqual([]);
  });

  it("gives a command's arguments and options with their help words, and none every command takes", () => {
    expect(named("approval")).toStrictEqual({
      name: "approval",
      description: message("command.approval"),
      arguments: [
        {
          term: "[mode]",
          description: message("argument.mode"),
          isRequired: false,
          choices: ["manual", "auto"],
        },
      ],
      options: [{ term: "--agent <id>", description: message("option.agent"), isRequired: false }],
    });
    expect(named("wallet create")?.options).toContainEqual({
      term: "--label <text>",
      description: message("option.walletLabel"),
      isRequired: true,
    });
  });
});
