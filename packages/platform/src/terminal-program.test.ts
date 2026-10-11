import { describe, expect, it } from "vitest";
import { startTerminalProgram } from "./terminal-program.js";

const live = new AbortController().signal;

describe("startTerminalProgram", () => {
  it("runs the program with only the environment given and answers its exit code", async () => {
    const program = await startTerminalProgram({
      file: process.execPath,
      args: [
        "-e",
        "process.exit(process.env.GIVEN === 'yes' && process.env.HOME === undefined ? 7 : 1)",
      ],
      env: { GIVEN: "yes" },
      signal: live,
    });
    await expect(program.exited).resolves.toStrictEqual({ exitCode: 7 });
  });

  it("stops a program that runs on when the signal aborts", async () => {
    const stop = new AbortController();
    const program = await startTerminalProgram({
      file: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1_000)"],
      env: {},
      signal: stop.signal,
    });
    stop.abort();
    const exit = await program.exited;
    expect(exit).not.toStrictEqual({ exitCode: 0 });
  });

  it("fails with a code for a program that is not on the PATH given", async () => {
    await expect(
      startTerminalProgram({
        file: "binference-no-such-program",
        args: [],
        env: { PATH: process.cwd() },
        signal: live,
      }),
    ).rejects.toMatchObject({ code: "platform.command_failed" });
  });
});
