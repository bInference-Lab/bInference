import { describe, expect, it } from "vitest";
import { runCommand, runCommandToExit } from "./run-command.js";

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
