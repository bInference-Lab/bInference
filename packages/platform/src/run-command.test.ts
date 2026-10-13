import { describe, expect, it } from "vitest";
import { runCommand, runCommandToExit, runCommandWithin } from "./run-command.js";

describe("run command", () => {
  it("returns what the program wrote to standard output", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "process.stdout.write('ready')"],
        new AbortController().signal,
      ),
    ).resolves.toBe("ready");
  });

  it("names the program that failed", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "process.exit(3)"], new AbortController().signal),
    ).rejects.toMatchObject({
      code: "platform.command_failed",
      details: { file: process.execPath },
    });
  });

  it("starts nothing on an aborted signal", async () => {
    await expect(
      runCommand(process.execPath, ["-e", ""], AbortSignal.abort(new Error("stopped"))),
    ).rejects.toMatchObject({ code: "platform.command_failed" });
  });
});

describe("run command to its exit", () => {
  it("returns the exit code and both outputs of a program that fails", async () => {
    await expect(
      runCommandToExit(
        process.execPath,
        ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
        new AbortController().signal,
      ),
    ).resolves.toStrictEqual({ exitCode: 3, stdout: "out", stderr: "err" });
  });

  it("fails with a code for a program that is not installed, or one that is stopped", async () => {
    const failed = { code: "platform.command_failed" };

    await expect(
      runCommandToExit("binference-no-such-program", [], new AbortController().signal),
    ).rejects.toMatchObject(failed);
    await expect(
      runCommandToExit(process.execPath, ["-e", ""], AbortSignal.abort(new Error("stopped"))),
    ).rejects.toMatchObject(failed);
  });
});

describe("run command within a time", () => {
  it("passes the variables it adds and returns how the program ended", async () => {
    const signal = new AbortController().signal;
    const exit = await runCommandWithin(
      process.execPath,
      ["-e", "process.stdout.write(process.env.BNF_PROBE ?? ''); process.exit(2)"],
      { signal, timeoutMs: 20_000, env: { BNF_PROBE: "set" } },
    );
    expect(exit).toStrictEqual({ exitCode: 2, stdout: "set", stderr: "" });
  });

  it("fails with a code for a program that runs past its time", async () => {
    const signal = new AbortController().signal;
    await expect(
      runCommandWithin(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        signal,
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ code: "platform.command_failed" });
  });
});
