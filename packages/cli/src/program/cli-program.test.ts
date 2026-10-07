import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualClock } from "@binference/core/testing";
import { messages } from "@binference/i18n";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { hostOn, type TestMachine } from "../e2e/test-host.js";
import { buildProgram } from "./cli-program.js";
import { runCli } from "./run-cli.js";

// A state folder that does not exist: no config, so the machine's language applies.
const machine: TestMachine = {
  folder: join(tmpdir(), "bnf-none"),
  clock: createManualClock(),
  signals: new EventEmitter(),
};

const zh = (key: string): string => messages.zh[`cli.${key}`] ?? `missing ${key}`;

// The commands that run, not the groups that hold them, such as `wallet list`.
function leafCommands(command: Command): readonly Command[] {
  return command.commands.flatMap((child) =>
    child.commands.length === 0 ? [child] : leafCommands(child),
  );
}

async function run(argv: readonly string[], env: Readonly<Record<string, string>> = {}) {
  const host = hostOn(machine, argv, env);
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

describe("the binference command tree", () => {
  it("gives every command --json and --yes", () => {
    const program = buildProgram({
      version: "1",
      message: (key) => key,
      host: { out: () => undefined, err: () => undefined },
      choose: () => undefined,
    });
    const commands = leafCommands(program);
    expect(commands.map((command) => command.name())).toStrictEqual([
      "start",
      "status",
      "health",
      "logs",
      "approval",
      "live",
      "paper",
      "confirm",
      "deny",
      "list",
      "address",
    ]);
    for (const command of commands) {
      const flags = command.options.map((option) => option.long);
      expect(flags).toContain("--json");
      expect(flags).toContain("--yes");
    }
  });

  it("prints its help in the owner's language and exits 0", async () => {
    const english = await run(["--help"]);
    expect(english.code).toBe(0);
    expect(english.stdout).toContain("Usage: binference");
    expect(english.stdout).toContain("Show whether the engine runs, its agents and its");
    const chinese = await run(["status", "--help"], { LANG: "zh_CN.UTF-8" });
    expect(chinese.code).toBe(0);
    expect(chinese.stdout).toContain(`${zh("help.usage")} binference status [options]`);
    expect(chinese.stdout).toContain(zh("help.options"));
    expect(chinese.stdout).toContain(zh("option.json"));
  });

  it("prints the version and exits 0", async () => {
    await expect(run(["--version"])).resolves.toMatchObject({
      code: 0,
      stdout: "2026.10.0-test\n",
    });
  });

  it("answers help for a command through the help command", async () => {
    const help = await run(["help", "logs"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--follow");
  });

  it.each([
    [["launch"]],
    [["status", "--colour"]],
    [["logs", "--lines", "0"]],
    [["logs", "-n", "x"]],
  ])("refuses %j with one message in the owner's language and exits 1", async (argv) => {
    const refused = await run(argv);
    expect(refused).toMatchObject({ code: 1, stdout: "" });
    expect(refused.stderr).toBe(
      "binference cannot read this command line. Run `binference --help` to see the commands " +
        "and what each one takes.\n",
    );
  });

  it("shows its help on standard error and exits 1 when no command is given", async () => {
    const bare = await run([]);
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain("Commands:");
  });

  it("names a relative BINFERENCE_HOME instead of failing on it", async () => {
    const refused = await run(["status"], { BINFERENCE_HOME: "relative/folder" });
    expect(refused.code).toBe(1);
    expect(refused.stderr).toBe(
      "BINFERENCE_HOME is not an absolute path. Set it to a full path, or unset it to use the " +
        "state folder in your home folder.\n",
    );
  });
});
